const Engine = Matter.Engine,
      Render = Matter.Render,
      Runner = Matter.Runner,
      Composite = Matter.Composite,
      Composites = Matter.Composites,
      Constraint = Matter.Constraint,
      MouseConstraint = Matter.MouseConstraint,
      Mouse = Matter.Mouse,
      World = Matter.World,
      Events = Matter.Events,
      Vector = Matter.Vector,
      Body = Matter.Body,
      Bodies = Matter.Bodies,
      Query = Matter.Query;

// 엔진 초기화 (터널링 방지 및 소프트 바디 안정성을 위해 iteration 대폭 증가)
const engine = Engine.create({
    positionIterations: 16,
    velocityIterations: 16
});
engine.world.gravity.y = 0.4;

// 캔버스 설정
const width = 600;
const height = 900;

const render = Render.create({
    element: document.getElementById('game-container'),
    engine: engine,
    options: {
        width,
        height,
        wireframes: false,
        background: 'transparent'
    }
});

// 물리 시뮬레이션에 보이지 않는 렌더러를 끄고 커스텀 렌더링 사용
render.options.wireframes = false;
render.options.showAngleIndicator = false;

// 렌더링 변수 추가
let renderCupLeftTopX = 65, renderCupLeftTopY = 504;
let renderCupRightTopX = 535, renderCupRightTopY = 504;

// Custom 렌더링을 위해 기본 렌더링을 덮어쓸 수 있도록 설정
// Matter.js Render 이벤트를 후킹합니다.
Events.on(render, 'afterRender', function() {
    const context = render.context;
    
    // 두들 스타일 컵(바구니) 렌더링
    // 물리 엔진 상의 cupLeft, cupRight, cupBottom의 교차점을 정확히 계산한 1:1 일치 좌표 (높이 더 낮춤)
    context.beginPath();
    context.moveTo(renderCupLeftTopX, renderCupLeftTopY); // 왼쪽 상단
    context.lineTo(148, 750); // 왼쪽 하단
    context.lineTo(452, 750); // 오른쪽 하단
    context.lineTo(renderCupRightTopX, renderCupRightTopY); // 오른쪽 상단
    
    // 외곽선 굵게
    context.lineWidth = 15;
    context.lineCap = 'round'; // 끝부분 둥글게
    context.lineJoin = 'round'; // 모서리 둥글게
    context.strokeStyle = '#000';
    context.stroke();
    
    // 하얀 빗살무늬 패턴
    context.lineWidth = 6;
    context.strokeStyle = '#fff';
    context.setLineDash([15, 10]);
    context.stroke();
    context.setLineDash([]);
    
    // 안쪽 선 정리
    context.lineWidth = 3;
    context.strokeStyle = '#000';
    context.stroke();
    
    // 모든 젤리 그리기
    Object.values(jellies).forEach(jelly => {
        if(!jelly || jelly.isMerged) return;
        
        context.beginPath();
        const particles = jelly.particles;
        const particleRadius = getJellySize(jelly.level) * 0.4;
        
        // 기준점을 중심핵에서 '외곽 입자들의 평균 위치(무게중심)'로 변경
        let cx = 0;
        let cy = 0;
        particles.forEach(p => {
            cx += p.position.x;
            cy += p.position.y;
        });
        cx /= particles.length;
        cy /= particles.length;
        
        // 시각적 렌더링 선을 실제 물리 충돌 경계선(바깥쪽)으로 확장합니다
        const N = particles.length;
        let edgePoints = particles.map((p, i) => {
            const prev = particles[(i - 1 + N) % N];
            const next = particles[(i + 1) % N];
            
            // 표면의 접선(Tangent) 벡터 계산
            let tx = next.position.x - prev.position.x;
            let ty = next.position.y - prev.position.y;
            
            // 90도 회전하여 법선(Normal) 생성
            let nx = -ty;
            let ny = tx;
            const len = Math.sqrt(nx*nx + ny*ny) || 1;
            nx /= len;
            ny /= len;
            
            // 법선이 젤리 바깥쪽을 향하도록 보정
            const rx = p.position.x - cx;
            const ry = p.position.y - cy;
            if (nx * rx + ny * ry < 0) {
                nx = -nx;
                ny = -ny;
            }
            
            return {
                x: p.position.x + nx * particleRadius,
                y: p.position.y + ny * particleRadius
            };
        });
        
        // 투명해짐(꼬임) 버그 방지: 점들을 중심 기준 각도순으로 정렬하여 다각형이 8자 형태로 스스로 교차하지 않게 만듭니다.
        edgePoints.sort((a, b) => {
            const angleA = Math.atan2(a.y - cy, a.x - cx);
            const angleB = Math.atan2(b.y - cy, b.x - cx);
            return angleA - angleB;
        });
        
        // 1. 스무딩 전의 젤리 평균 반경(부피) 측정
        let initialRadiusSum = 0;
        edgePoints.forEach(p => {
            const dx = p.x - cx;
            const dy = p.y - cy;
            initialRadiusSum += Math.sqrt(dx*dx + dy*dy);
        });
        const initialAverageRadius = initialRadiusSum / N;

        // 2. 표면 스무딩 (모서리나 다른 젤리에 눌려 뾰족하게 파인 부분 완화)
        for (let iter = 0; iter < 2; iter++) {
            let smoothed = [];
            for (let i = 0; i < N; i++) {
                const prev = edgePoints[(i - 1 + N) % N];
                const curr = edgePoints[i];
                const next = edgePoints[(i + 1) % N];
                smoothed.push({
                    x: curr.x * 0.6 + (prev.x + next.x) * 0.2,
                    y: curr.y * 0.6 + (prev.y + next.y) * 0.2
                });
            }
            edgePoints = smoothed;
        }

        // 3. 부피 보존 보정 (스무딩으로 인해 젤리가 작아지는 현상을 완벽하게 복구하여 겹침/틈새 방지)
        let smoothedRadiusSum = 0;
        edgePoints.forEach(p => {
            const dx = p.x - cx;
            const dy = p.y - cy;
            smoothedRadiusSum += Math.sqrt(dx*dx + dy*dy);
        });
        const smoothedAverageRadius = smoothedRadiusSum / N;
        
        // 깎여나간 비율만큼 다시 바깥으로 팽창시킵니다.
        const volumeScale = smoothedAverageRadius > 0 ? (initialAverageRadius / smoothedAverageRadius) : 1;
        
        edgePoints = edgePoints.map(p => {
            const dx = p.x - cx;
            const dy = p.y - cy;
            return {
                x: cx + dx * volumeScale,
                y: cy + dy * volumeScale
            };
        });

        // 완벽하게 닫힌 부드러운 곡선(Closed Spline) 그리기
        // 시작점을 마지막 점과 첫 번째 점의 정중앙으로 잡아야 곡선이 뾰족해지지 않고 부드럽게 한 바퀴 이어집니다.
        const startX = (edgePoints[N - 1].x + edgePoints[0].x) / 2;
        const startY = (edgePoints[N - 1].y + edgePoints[0].y) / 2;
        context.moveTo(startX, startY);
        
        for (let i = 0; i < N; i++) {
            const p = edgePoints[i];
            const nextP = edgePoints[(i + 1) % N];
            const midX = (p.x + nextP.x) / 2;
            const midY = (p.y + nextP.y) / 2;
            context.quadraticCurveTo(p.x, p.y, midX, midY);
        }
        
        context.closePath();
        
        // 조준 중인 젤리는 추가 레이어(아우라)로 강조
        if (typeof hoveredJellyId !== 'undefined' && hoveredJellyId === jelly.center.jellyId) {
            context.save();
            context.lineWidth = 16;
            context.strokeStyle = "rgba(255, 50, 50, 0.7)";
            context.lineJoin = "round";
            context.stroke();
            context.restore();
        }
        
        // 그라데이션 및 색상 채우기
        const color = getJellyColor(jelly.level);
        context.fillStyle = color;
        context.fill();
        
        // 두들 스타일 굵은 검은색 테두리
        context.lineWidth = 6;
        context.strokeStyle = "#000";
        context.stroke();
        
        // 표정 그리기 (얼굴)
        const angle = jelly.center.angle;
        const R = getJellySize(jelly.level) * jelly.currentScale;
        const eyeDist = R * 0.35;
        const eyeSize = R * 0.2;
        
        context.save();
        context.translate(cx, cy);
        context.rotate(angle);
        
        // 흰자
        context.beginPath();
        context.arc(-eyeDist, -eyeDist * 0.2, eyeSize, 0, 2*Math.PI);
        context.fillStyle = '#fff';
        context.fill();
        context.lineWidth = 3;
        context.stroke();
        
        context.beginPath();
        context.arc(eyeDist, -eyeDist * 0.2, eyeSize, 0, 2*Math.PI);
        context.fillStyle = '#fff';
        context.fill();
        context.stroke();
        
        // 검은 눈동자
        context.beginPath();
        context.arc(-eyeDist + eyeSize*0.2, -eyeDist * 0.2, eyeSize*0.5, 0, 2*Math.PI);
        context.arc(eyeDist - eyeSize*0.2, -eyeDist * 0.2, eyeSize*0.5, 0, 2*Math.PI);
        context.fillStyle = '#000';
        context.fill();
        
        // 입 (작은 미소)
        context.beginPath();
        context.arc(0, eyeDist * 0.5, eyeSize * 0.6, 0, Math.PI);
        context.stroke();
        
        context.restore();
    });
});

// 벽 및 바닥 생성 (컵 모양 \_/ )
// 바닥 바깥 공간 (게임 오버 판정선)
const groundFloor = Bodies.rectangle(300, 880, 800, 40, { 
    isStatic: true, 
    render: { visible: false },
    isFloor: true
});

// 컵 바닥 (렌더링 선과 완벽 일치: 두께 15px, Y: 757.5 = top 750)
const cupBottom = Bodies.rectangle(300, 757.5, 304, 15, { 
    isStatic: true, 
    render: { visible: false } 
});

// 컵 왼쪽 벽 (렌더링 선과 완벽 일치: 두께 15px)
let currentCupLeft = Bodies.rectangle(106.5, 627, 15, 260, { 
    isStatic: true, 
    angle: -0.3252, 
    friction: 0.8,
    render: { visible: false } 
});

// 컵 오른쪽 벽 (렌더링 선과 완벽 일치: 두께 15px)
let currentCupRight = Bodies.rectangle(493.5, 627, 15, 260, { 
    isStatic: true, 
    angle: 0.3252, 
    friction: 0.8,
    render: { visible: false } 
});

// 컵 양쪽 끝 뾰족한 단면이 젤리를 찌르지 못하도록 뭉툭한 범퍼(캡)를 씌웁니다
let currentCupLeftTop = Bodies.circle(65, 504, 15, { isStatic: true, friction: 0.8, render: { visible: false } });
let currentCupRightTop = Bodies.circle(535, 504, 15, { isStatic: true, friction: 0.8, render: { visible: false } });

World.add(engine.world, [groundFloor, cupBottom, currentCupLeft, currentCupRight, currentCupLeftTop, currentCupRightTop]);

// 젤리 설정 (끝없이 진화하도록 함수 기반으로 변경)
const JELLY_COLORS = [
    '#5ecdf2', // 0 Light Blue
    '#7df25e', // 1 Light Green
    '#d85ef2', // 2 Purple/Pink
    '#f25e5e', // 3 Red
    '#f2985e', // 4 Orange
    '#f2e85e', // 5 Yellow
    '#ffffff', // 6 White
    '#555555', // 7 Dark Grey
    '#ff7eb3', // 8
    '#8fd3f4', // 9
    '#fccb90'  // 10
];

function getJellySize(level) {
    // 0단계: 24, 이후 단계마다 커지는 폭(jump)이 1씩 줄어드는 등차수열
    // 예: 24, 34(+10), 43(+9), 51(+8), 58(+7) ... (단, 증가폭이 최소 1 밑으로는 안 떨어지게 제한)
    let size = 24;
    let jump = 10;
    for (let i = 0; i < level; i++) {
        size += jump;
        jump = Math.max(1, jump - 1);
    }
    return size;
}

function getJellyColor(level) {
    return JELLY_COLORS[level % JELLY_COLORS.length];
}

let jellies = {};
let jellyIdCounter = 0;
let score = 0;
let isGameOver = false;

// 젤리 생성 함수 (소프트 바디)
function createJelly(x, y, level) {
    const radius = getJellySize(level);
    const particleRadius = radius * 0.4; // 젤리의 가장자리 작은 원들 반경
    const numParticles = Math.min(16 + level * 2, 32); // 크기에 따라 입자 수 증가
    const composite = Composite.create();
    const id = jellyIdCounter++;
    
    // 음수 group ID를 사용해 같은 젤리 몸체 내 입자들끼리 겹칠 수 있게 허용 (폭발 방지)
    const groupId = Body.nextGroup(true);
    
    // 이전에는 질량 차이를 줄이기 위해 반비례로 낮췄으나, 너무 가벼워져서 작은 젤리 더미에 밀려 올라가는 현상이 생겼습니다.
    // 따라서 Math.sqrt(제곱근)를 적용하여 큰 젤리가 작은 젤리를 으깨지 않을 정도의 '적당한 무게감'을 유지하도록 타협점을 찾습니다.
    const densityScale = Math.sqrt(40 / radius); 
    
    const center = Bodies.circle(x, y, radius * 0.5, {
        isCenter: true, jellyId: id, jellyLevel: level,
        friction: 0.4, restitution: 0.0, density: 0.02 * densityScale, frictionAir: 0.005,
        collisionFilter: { group: groupId },
        render: { visible: false }
    });
    
    Composite.add(composite, center);
    
    const particles = [];
    const angleStep = (Math.PI * 2) / numParticles;
    
    for (let i = 0; i < numParticles; i++) {
        const pX = x + Math.cos(i * angleStep) * radius;
        const pY = y + Math.sin(i * angleStep) * radius;
        
        const particle = Bodies.circle(pX, pY, particleRadius, {
            isOuter: true, jellyId: id, jellyLevel: level,
            friction: 0.4, restitution: 0.0, density: 0.008 * densityScale, frictionAir: 0.005,
            collisionFilter: { group: groupId },
            render: { visible: false }
        });
        
        particles.push(particle);
        Composite.add(composite, particle);
        
        // 크기에 반비례하는 탄성 계수 적용 (진동 방지를 위해 전체 장력을 이전의 절반으로 완화)
        const stiffScale = 15 / radius;
        const centerStiff = 0.1 * stiffScale;
        const outerStiff = 0.2 * stiffScale;
        const crossStiff = 0.1 * stiffScale;
        
        // 중심과 연결 (스프링) - 크기에 비례한 탄력 부여
        Composite.add(composite, Constraint.create({
            bodyA: center, bodyB: particle,
            length: radius, stiffness: centerStiff, damping: 0.1,
            render: { visible: false }
        }));
    }
    
    // 외곽 입자끼리 연결 (피부 역할: 질기게 유지하여 벽이 파고드는 것을 방지)
    for (let i = 0; i < numParticles; i++) {
        const p1 = particles[i];
        const p2 = particles[(i + 1) % numParticles];
        const stiffScale = 15 / radius;
        
        Composite.add(composite, Constraint.create({
            bodyA: p1, bodyB: p2,
            stiffness: 0.2 * stiffScale,
            damping: 0.1,
            render: { visible: false }
        }));
        
        // 젤리 형태 유지를 위한 보조 스프링 (마주보는 입자 연결로 부피 유지)
        const pOpposite = particles[(i + Math.floor(numParticles / 2)) % numParticles];
        Composite.add(composite, Constraint.create({
            bodyA: p1, bodyB: pOpposite,
            stiffness: 0.05 * stiffScale, damping: 0.1,
            render: { visible: false }
        }));
    }
    
    jellies[id] = { 
        composite, level, particles, center, isMerged: false,
        currentScale: 0.3, // 초기 생성 크기 (30%)
        targetScale: 1.0
    };
    
    // 생성 직후 부피를 줄여서 스폰하고 점진적으로 커지게 만듭니다 (다른 젤리 삼킴 방지)
    const initialFactor = 0.3;
    Body.scale(center, initialFactor, initialFactor);
    particles.forEach(p => {
        Body.scale(p, initialFactor, initialFactor);
        const dx = p.position.x - center.position.x;
        const dy = p.position.y - center.position.y;
        Body.setPosition(p, { 
            x: center.position.x + dx * initialFactor, 
            y: center.position.y + dy * initialFactor 
        });
    });
    composite.constraints.forEach(c => c.length *= initialFactor);
    
    World.add(engine.world, composite);
    return id;
}

// 초기 테스트용 드롭
let currentX = width / 2;
let nextLevel = Math.floor(Math.random() * 3);

// 특수 스킬 로직
let isWallExtended = false;
let extendWallTimeLeft = 0;
let isDeleteMode = false;
let visualParticles = [];
let currentY = 50;
let hoveredJellyId = null;

const extendBtn = document.getElementById('skill-extend-btn');
const deleteBtn = document.getElementById('skill-delete-btn');
const extendTimerEl = document.getElementById('skill-extend-timer');

extendBtn.addEventListener('click', () => {
    if (isWallExtended || isGameOver || extendBtn.disabled) return;
    
    isWallExtended = true;
    extendBtn.disabled = true;
    
    const targetLeftTopX = 23.5, targetLeftTopY = 381;
    const targetRightTopX = 576.5, targetRightTopY = 381;
    const startLeftTopX = 65, startLeftTopY = 504;
    const startRightTopX = 535, startRightTopY = 504;
    
    extendWallTimeLeft = 20;
    extendTimerEl.textContent = extendWallTimeLeft;
    extendTimerEl.classList.remove('hidden');
    
    const timerInterval = setInterval(() => {
        if (isGameOver) {
            clearInterval(timerInterval);
            extendWallTimeLeft = 0;
            extendTimerEl.classList.add('hidden');
            return;
        }
        extendWallTimeLeft--;
        extendTimerEl.textContent = extendWallTimeLeft;
        if (extendWallTimeLeft <= 0) {
            clearInterval(timerInterval);
            extendTimerEl.classList.add('hidden');
        }
    }, 1000);
    
    let progress = 0;
    const animInterval = setInterval(() => {
        progress += 0.05;
        if (progress >= 1) {
            progress = 1;
            clearInterval(animInterval);
        }
        
        renderCupLeftTopX = startLeftTopX + (targetLeftTopX - startLeftTopX) * progress;
        renderCupLeftTopY = startLeftTopY + (targetLeftTopY - startLeftTopY) * progress;
        renderCupRightTopX = startRightTopX + (targetRightTopX - startRightTopX) * progress;
        renderCupRightTopY = startRightTopY + (targetRightTopY - startRightTopY) * progress;
        
        World.remove(engine.world, [currentCupLeft, currentCupRight, currentCupLeftTop, currentCupRightTop]);
        
        const currentLength = 260 + (130 * progress);
        const leftCenterX = (148 + renderCupLeftTopX) / 2;
        const leftCenterY = (750 + renderCupLeftTopY) / 2;
        const rightCenterX = (452 + renderCupRightTopX) / 2;
        const rightCenterY = (750 + renderCupRightTopY) / 2;
        
        currentCupLeft = Bodies.rectangle(leftCenterX, leftCenterY, 15, currentLength, { isStatic: true, angle: -0.3252, friction: 0.8, render: { visible: false } });
        currentCupRight = Bodies.rectangle(rightCenterX, rightCenterY, 15, currentLength, { isStatic: true, angle: 0.3252, friction: 0.8, render: { visible: false } });
        currentCupLeftTop = Bodies.circle(renderCupLeftTopX, renderCupLeftTopY, 15, { isStatic: true, friction: 0.8, render: { visible: false } });
        currentCupRightTop = Bodies.circle(renderCupRightTopX, renderCupRightTopY, 15, { isStatic: true, friction: 0.8, render: { visible: false } });
        
        World.add(engine.world, [currentCupLeft, currentCupRight, currentCupLeftTop, currentCupRightTop]);
    }, 16);
    
    setTimeout(() => {
        if (isGameOver) return;
        
        let backProgress = 0;
        const backInterval = setInterval(() => {
            backProgress += 0.05;
            if (backProgress >= 1) {
                backProgress = 1;
                clearInterval(backInterval);
                isWallExtended = false;
            }
            
            const p = 1 - backProgress;
            renderCupLeftTopX = startLeftTopX + (targetLeftTopX - startLeftTopX) * p;
            renderCupLeftTopY = startLeftTopY + (targetLeftTopY - startLeftTopY) * p;
            renderCupRightTopX = startRightTopX + (targetRightTopX - startRightTopX) * p;
            renderCupRightTopY = startRightTopY + (targetRightTopY - startRightTopY) * p;
            
            World.remove(engine.world, [currentCupLeft, currentCupRight, currentCupLeftTop, currentCupRightTop]);
            
            const currentLength = 260 + (130 * p);
            const leftCenterX = (148 + renderCupLeftTopX) / 2;
            const leftCenterY = (750 + renderCupLeftTopY) / 2;
            const rightCenterX = (452 + renderCupRightTopX) / 2;
            const rightCenterY = (750 + renderCupRightTopY) / 2;
            
            currentCupLeft = Bodies.rectangle(leftCenterX, leftCenterY, 15, currentLength, { isStatic: true, angle: -0.3252, friction: 0.8, render: { visible: false } });
            currentCupRight = Bodies.rectangle(rightCenterX, rightCenterY, 15, currentLength, { isStatic: true, angle: 0.3252, friction: 0.8, render: { visible: false } });
            currentCupLeftTop = Bodies.circle(renderCupLeftTopX, renderCupLeftTopY, 15, { isStatic: true, friction: 0.8, render: { visible: false } });
            currentCupRightTop = Bodies.circle(renderCupRightTopX, renderCupRightTopY, 15, { isStatic: true, friction: 0.8, render: { visible: false } });
            
            World.add(engine.world, [currentCupLeft, currentCupRight, currentCupLeftTop, currentCupRightTop]);
        }, 16);
    }, 20000);
});

deleteBtn.addEventListener('click', () => {
    if (isDeleteMode || deleteBtn.disabled || isGameOver) return;
    isDeleteMode = true;
    deleteBtn.classList.add('active-skill');
    document.getElementById('game-container').classList.add('crosshair-mode');
});

// 마우스 드래그 이동을 비활성화하기 위해 MouseConstraint 제거
// const mouse = Mouse.create(render.canvas);
// const mouseConstraint = MouseConstraint.create(engine, {
//     mouse: mouse,
//     constraint: {
//         stiffness: 0.2,
//         render: { visible: false }
//     }
// });
// World.add(engine.world, mouseConstraint);

// 드롭 인터랙션
let canDrop = true;

// 가이드라인 및 파티클 렌더링
Events.on(render, 'afterRender', function() {
    const context = render.context;
    
    // 파티클 렌더링
    for (let i = visualParticles.length - 1; i >= 0; i--) {
        let p = visualParticles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.01; // 100 frames
        
        if (p.life <= 0) {
            visualParticles.splice(i, 1);
            continue;
        }
        
        context.beginPath();
        context.arc(p.x, p.y, p.radius * p.life, 0, Math.PI * 2);
        context.strokeStyle = `rgba(180, 180, 180, ${p.life})`;
        context.lineWidth = 3;
        context.stroke();
    }
    
    if (isDeleteMode) {
        // 화면 어둡게
        context.fillStyle = "rgba(0, 0, 0, 0.6)";
        context.fillRect(0, 0, width, height);
        
        // 조준선 (Crosshair)
        context.beginPath();
        context.moveTo(currentX - 40, currentY);
        context.lineTo(currentX + 40, currentY);
        context.moveTo(currentX, currentY - 40);
        context.lineTo(currentX, currentY + 40);
        context.strokeStyle = "red";
        context.lineWidth = 3;
        context.stroke();
        
        context.beginPath();
        context.arc(currentX, currentY, 25, 0, Math.PI * 2);
        context.stroke();
        return;
    }
    
    if (!canDrop || isGameOver) return;
    
    context.beginPath();
    context.moveTo(currentX, 50);
    context.lineTo(currentX, 800);
    context.strokeStyle = "rgba(0, 0, 0, 0.3)";
    context.lineWidth = 2;
    context.setLineDash([10, 10]);
    context.stroke();
    context.setLineDash([]);
    
    // 다음 드롭될 젤리 미리보기 (실제 물리 충돌 범위인 1.4배 크기 반영)
    context.beginPath();
    context.arc(currentX, 50, getJellySize(nextLevel) * 1.4, 0, 2 * Math.PI);
    context.fillStyle = getJellyColor(nextLevel);
    context.fill();
    context.lineWidth = 4;
    context.strokeStyle = '#000';
    context.stroke();
});

render.canvas.addEventListener('mousemove', (e) => {
    const rect = render.canvas.getBoundingClientRect();
    const scaleX = render.canvas.width / rect.width;
    const scaleY = render.canvas.height / rect.height;
    currentX = (e.clientX - rect.left) * scaleX;
    currentY = (e.clientY - rect.top) * scaleY;
    
    if (isDeleteMode) {
        // 조준 모드에서는 마우스 위치에 있는 젤리 식별
        const bodies = Composite.allBodies(engine.world);
        const hoveredBodies = Query.point(bodies, { x: currentX, y: currentY });
        hoveredJellyId = null;
        for (let b of hoveredBodies) {
            if (b.jellyId !== undefined) {
                hoveredJellyId = b.jellyId;
                break;
            }
        }
    } else {
        // 좌우 한계선 (조준 모드가 아닐 때만 적용)
        currentX = Math.max(30, Math.min(570, currentX));
        hoveredJellyId = null;
    }
});

render.canvas.addEventListener('click', (e) => {
    if (isGameOver) return;
    
    if (isDeleteMode) {
        const rect = render.canvas.getBoundingClientRect();
        const scaleX = render.canvas.width / rect.width;
        const scaleY = render.canvas.height / rect.height;
        const clickX = (e.clientX - rect.left) * scaleX;
        const clickY = (e.clientY - rect.top) * scaleY;
        
        const bodies = Composite.allBodies(engine.world);
        const clicked = Query.point(bodies, { x: clickX, y: clickY });
        
        let jellyIdToRemove = null;
        for (let body of clicked) {
            if (body.jellyId !== undefined) {
                jellyIdToRemove = body.jellyId;
                break;
            }
        }
        
        if (jellyIdToRemove !== null) {
            const jelly = jellies[jellyIdToRemove];
            if (jelly && !jelly.isMerged) {
                // 파티클 생성
                const jX = jelly.center.position.x;
                const jY = jelly.center.position.y;
                const jR = getJellySize(jelly.level);
                for (let i = 0; i < 20; i++) {
                    visualParticles.push({
                        x: jX + (Math.random() - 0.5) * jR,
                        y: jY + (Math.random() - 0.5) * jR,
                        vx: (Math.random() - 0.5) * 6,
                        vy: (Math.random() - 0.5) * 6,
                        radius: Math.random() * 12 + 5,
                        life: 1.0
                    });
                }
                
                World.remove(engine.world, jelly.composite);
                delete jellies[jellyIdToRemove];
                
                isDeleteMode = false;
                hoveredJellyId = null;
                deleteBtn.classList.remove('active-skill');
                deleteBtn.disabled = true;
                document.getElementById('game-container').classList.remove('crosshair-mode');
                
                // 1회용이므로 다시 활성화하지 않음
            }
        } else {
            // 빈 공간 클릭 시 취소
            isDeleteMode = false;
            hoveredJellyId = null;
            deleteBtn.classList.remove('active-skill');
            document.getElementById('game-container').classList.remove('crosshair-mode');
        }
        return;
    }

    if (!canDrop) return;
    
    createJelly(currentX, 50, nextLevel);
    
    canDrop = false;
    nextLevel = Math.floor(Math.random() * 3);
    
    // 쿨타임
    setTimeout(() => {
        canDrop = true;
    }, 1000);
});

// 충돌 이벤트 (병합 및 게임오버)
let mergeQueue = [];

Events.on(engine, 'collisionStart', function(event) {
    const pairs = event.pairs;
    
    for (let i = 0; i < pairs.length; i++) {
        const bodyA = pairs[i].bodyA;
        const bodyB = pairs[i].bodyB;
        
        // 게임오버 체크: 젤리가 바닥(groundFloor)에 닿으면 게임 오버
        if ((bodyA.isFloor && bodyB.jellyId !== undefined) || 
            (bodyB.isFloor && bodyA.jellyId !== undefined)) {
            triggerGameOver();
            return;
        }
        
        // 젤리 병합 체크
        if (bodyA.isOuter && bodyB.isOuter && 
            bodyA.jellyId !== bodyB.jellyId && 
            bodyA.jellyLevel === bodyB.jellyLevel) {
            
            const level = bodyA.jellyLevel;
            const idA = bodyA.jellyId;
            const idB = bodyB.jellyId;
            
            if (!jellies[idA].isMerged && !jellies[idB].isMerged) {
                
                jellies[idA].isMerged = true;
                jellies[idB].isMerged = true;
                
                mergeQueue.push({ idA, idB, level: level + 1 });
            }
        }
    }
});

// 물리 엔진 업데이트 전에 병합 처리 및 점진적 크기 증가 (렌더링 사이클 보호)
Events.on(engine, 'beforeUpdate', function() {
    
    // 속도 제한 (터널링 방지: 중력이 중첩되어 뚫고 나가는 것 방지)
    engine.world.bodies.forEach(body => {
        if (body.isOuter || body.isCenter) {
            const maxVelocity = 20;
            if (Vector.magnitude(body.velocity) > maxVelocity) {
                Body.setVelocity(body, Vector.mult(Vector.normalise(body.velocity), maxVelocity));
            }
        }
    });

    // 젤리 스케일업 애니메이션 (천천히 커지며 다른 젤리를 밀어냅니다)
    Object.values(jellies).forEach(jelly => {
        if (jelly && !jelly.isMerged && jelly.currentScale < jelly.targetScale) {
            let step = 0.04; // 한 프레임당 4%씩 커짐
            if (jelly.currentScale + step > jelly.targetScale) {
                step = jelly.targetScale - jelly.currentScale;
            }
            
            const factor = (jelly.currentScale + step) / jelly.currentScale;
            
            Body.scale(jelly.center, factor, factor);
            jelly.particles.forEach(p => {
                Body.scale(p, factor, factor);
                const dx = p.position.x - jelly.center.position.x;
                const dy = p.position.y - jelly.center.position.y;
                Body.setPosition(p, { 
                    x: jelly.center.position.x + dx * factor, 
                    y: jelly.center.position.y + dy * factor 
                });
            });
            jelly.composite.constraints.forEach(c => {
                c.length *= factor;
            });
            
            jelly.currentScale += step;
        }
    });

    while (mergeQueue.length > 0) {
        const mergeData = mergeQueue.shift();
        const { idA, idB, level } = mergeData;
        
        const jellyA = jellies[idA];
        const jellyB = jellies[idB];
        
        if (jellyA && jellyB) {
            // 위치 계산 (두 젤리의 중간점)
            const posA = jellyA.center.position;
            const posB = jellyB.center.position;
            const newX = (posA.x + posB.x) / 2;
            const newY = (posA.y + posB.y) / 2;
            
            // 기존 젤리 제거
            World.remove(engine.world, jellyA.composite);
            World.remove(engine.world, jellyB.composite);
            
            delete jellies[idA];
            delete jellies[idB];
            
            // 점수 추가
            score += (level * 10);
            document.getElementById('score').innerText = score;
            
            // 새로운 큰 젤리 생성
            createJelly(newX, newY, level);
        }
    }
});

function triggerGameOver() {
    if (isGameOver) return;
    isGameOver = true;
    document.getElementById('game-over-screen').classList.remove('hidden');
    document.getElementById('final-score').innerText = score;
}

document.getElementById('restart-btn').addEventListener('click', () => {
    // 모든 젤리 제거
    Object.values(jellies).forEach(jelly => {
        World.remove(engine.world, jelly.composite);
    });
    jellies = {};
    score = 0;
    document.getElementById('score').innerText = score;
    isGameOver = false;
    document.getElementById('game-over-screen').classList.add('hidden');
    canDrop = true;
    
    // 스킬 초기화
    isWallExtended = false;
    extendWallTimeLeft = 0;
    extendTimerEl.classList.add('hidden');
    isDeleteMode = false;
    visualParticles = [];
    extendBtn.disabled = false;
    deleteBtn.disabled = false;
    deleteBtn.classList.remove('active-skill');
    document.getElementById('game-container').classList.remove('crosshair-mode');
    
    // 컵 원상복구
    World.remove(engine.world, [currentCupLeft, currentCupRight, currentCupLeftTop, currentCupRightTop]);
    renderCupLeftTopX = 65; renderCupLeftTopY = 504;
    renderCupRightTopX = 535; renderCupRightTopY = 504;
    currentCupLeft = Bodies.rectangle(106.5, 627, 15, 260, { isStatic: true, angle: -0.3252, friction: 0.8, render: { visible: false } });
    currentCupRight = Bodies.rectangle(493.5, 627, 15, 260, { isStatic: true, angle: 0.3252, friction: 0.8, render: { visible: false } });
    currentCupLeftTop = Bodies.circle(65, 504, 15, { isStatic: true, friction: 0.8, render: { visible: false } });
    currentCupRightTop = Bodies.circle(535, 504, 15, { isStatic: true, friction: 0.8, render: { visible: false } });
    World.add(engine.world, [currentCupLeft, currentCupRight, currentCupLeftTop, currentCupRightTop]);
});

// 엔진 실행
Render.run(render);
Runner.run(Runner.create(), engine);
