/**
 * ╔══════════════════════════════════════════════╗
 * ║        🦑 SQUID GAME — FX ENGINE            ║
 * ║   공통 이펙트 · 날씨 · 멘트 · 캐릭터        ║
 * ╚══════════════════════════════════════════════╝
 *
 * 사용법:
 *   <script src="squid_fx.js"></script>
 *   SQ.weather('rain');
 *   SQ.announce('게임을 시작하겠습니다');
 *   SQ.flash('red');
 *   SQ.shake(400);
 */

const SQ = (() => {
  'use strict';

  // ═══════════════════════════════════════
  // 내부 상태
  // ═══════════════════════════════════════
  let _weatherCanvas = null;
  let _weatherCtx = null;
  let _weatherRAF = null;
  let _currentWeather = null;
  let _particles = [];
  let _announceQueue = [];
  let _announcing = false;

  // ═══════════════════════════════════════
  // 초기화 — DOM 주입
  // ═══════════════════════════════════════
  function _init() {
    // 이미 초기화됨
    if (document.getElementById('sq-fx-layer')) return;

    // 날씨 캔버스
    _weatherCanvas = document.createElement('canvas');
    _weatherCanvas.id = 'sq-weather-canvas';
    _weatherCanvas.style.cssText = 'position:fixed;inset:0;z-index:5;pointer-events:none;';
    document.body.appendChild(_weatherCanvas);
    _weatherCtx = _weatherCanvas.getContext('2d');
    _resizeCanvas();
    window.addEventListener('resize', _resizeCanvas);

    // FX 레이어 (flash, shake용)
    const fxLayer = document.createElement('div');
    fxLayer.id = 'sq-fx-layer';
    fxLayer.style.cssText = 'position:fixed;inset:0;z-index:9999;pointer-events:none;';
    document.body.appendChild(fxLayer);

    // 멘트 오버레이
    const announceEl = document.createElement('div');
    announceEl.id = 'sq-announce';
    document.body.appendChild(announceEl);

    // 비네팅 레이어
    const vignette = document.createElement('div');
    vignette.id = 'sq-vignette';
    document.body.appendChild(vignette);

    // 심장박동 레이어
    const pulse = document.createElement('div');
    pulse.id = 'sq-pulse';
    document.body.appendChild(pulse);

    // 파티클 캔버스 (탈락/클리어 이펙트용)
    const particleCanvas = document.createElement('canvas');
    particleCanvas.id = 'sq-particle-canvas';
    particleCanvas.style.cssText = 'position:fixed;inset:0;z-index:800;pointer-events:none;';
    document.body.appendChild(particleCanvas);

    // CSS 주입
    _injectCSS();
  }

  function _resizeCanvas() {
    if (_weatherCanvas) {
      _weatherCanvas.width = window.innerWidth;
      _weatherCanvas.height = window.innerHeight;
    }
    const pc = document.getElementById('sq-particle-canvas');
    if (pc) {
      pc.width = window.innerWidth;
      pc.height = window.innerHeight;
    }
  }

  // ═══════════════════════════════════════
  // CSS 주입
  // ═══════════════════════════════════════
  function _injectCSS() {
    const style = document.createElement('style');
    style.id = 'sq-fx-styles';
    style.textContent = `
/* ══ 멘트 시스템 ══ */
#sq-announce{
  position:fixed;top:56px;right:8px;z-index:900;
  display:flex;flex-direction:column;align-items:flex-end;
  pointer-events:none;max-width:55vw;
}
.sq-msg{
  background:rgba(0,0,0,.88);backdrop-filter:blur(12px);
  border:1px solid rgba(232,0,42,.3);border-radius:10px;
  padding:7px 14px;margin-bottom:6px;
  font-family:'Black Han Sans','Noto Sans KR',sans-serif;
  font-size:.75rem;letter-spacing:.04em;color:#f0ece8;
  text-align:right;line-height:1.5;
  opacity:0;transform:translateX(12px) scale(.95);
  animation:sqMsgIn .35s ease forwards;
  text-shadow:0 0 12px rgba(232,0,42,.3);
}
.sq-msg.guard{
  border-color:rgba(232,0,42,.6);
  color:#ff4466;
  text-shadow:0 0 16px rgba(232,0,42,.5);
}
.sq-msg.system{
  border-color:rgba(255,214,0,.4);
  color:#ffd600;
  text-shadow:0 0 14px rgba(255,214,0,.4);
}
.sq-msg.player{
  border-color:rgba(255,112,32,.4);
  color:#ffaa44;
  text-shadow:0 0 12px rgba(255,112,32,.3);
  font-family:'Noto Sans KR',sans-serif;
  font-weight:700;font-size:.78rem;
}
.sq-msg.danger{
  border-color:rgba(232,0,42,.8);
  background:rgba(80,0,0,.92);
  color:#ff2244;
  animation:sqMsgIn .35s ease forwards, sqDangerPulse 1s ease infinite;
}
.sq-msg.fade-out{
  animation:sqMsgOut .4s ease forwards;
}
@keyframes sqMsgIn{
  0%{opacity:0;transform:translateX(12px) scale(.95)}
  100%{opacity:1;transform:translateX(0) scale(1)}
}
@keyframes sqMsgOut{
  0%{opacity:1;transform:translateX(0) scale(1)}
  100%{opacity:0;transform:translateX(12px) scale(.96)}
}
@keyframes sqDangerPulse{
  0%,100%{box-shadow:0 0 20px rgba(232,0,42,.3)}
  50%{box-shadow:0 0 40px rgba(232,0,42,.6)}
}

/* ══ 대형 카운트다운 텍스트 ══ */
.sq-big-text{
  position:fixed;inset:0;z-index:850;
  display:flex;align-items:center;justify-content:center;
  pointer-events:none;
  font-family:'Black Han Sans',sans-serif;
  font-size:4.5rem;letter-spacing:.15em;
  color:#fff;text-shadow:0 0 60px rgba(232,0,42,.8),0 0 120px rgba(232,0,42,.4);
  opacity:0;transform:scale(1.8);
  animation:sqBigIn .5s ease forwards;
}
.sq-big-text.out{
  animation:sqBigOut .4s ease forwards;
}
@keyframes sqBigIn{
  0%{opacity:0;transform:scale(1.8)}
  60%{opacity:1;transform:scale(.95)}
  100%{opacity:1;transform:scale(1)}
}
@keyframes sqBigOut{
  0%{opacity:1;transform:scale(1)}
  100%{opacity:0;transform:scale(.6)}
}

/* ══ 비네팅 ══ */
#sq-vignette{
  position:fixed;inset:0;z-index:6;pointer-events:none;
  background:radial-gradient(ellipse at 50% 50%,transparent 55%,rgba(0,0,0,.5) 100%);
  opacity:0;transition:opacity .6s ease;
}
#sq-vignette.active{opacity:1;}
#sq-vignette.intense{
  background:radial-gradient(ellipse at 50% 50%,transparent 35%,rgba(0,0,0,.7) 100%);
}

/* ══ 심장박동 펄스 ══ */
#sq-pulse{
  position:fixed;inset:0;z-index:7;pointer-events:none;
  border:3px solid transparent;
  transition:border-color .15s;
}
#sq-pulse.active{
  animation:sqPulse 1s ease infinite;
}
#sq-pulse.warning{
  animation:sqPulseWarn .7s ease infinite;
}
@keyframes sqPulse{
  0%,100%{border-color:rgba(232,0,42,0)}
  50%{border-color:rgba(232,0,42,.2)}
}
@keyframes sqPulseWarn{
  0%,100%{border-color:rgba(232,0,42,0)}
  50%{border-color:rgba(232,0,42,.5)}
}

/* ══ 화면 흔들림 ══ */
@keyframes sqShake{
  0%,100%{transform:translate(0,0)}
  10%{transform:translate(-4px,2px)}
  20%{transform:translate(3px,-3px)}
  30%{transform:translate(-3px,1px)}
  40%{transform:translate(4px,-2px)}
  50%{transform:translate(-2px,3px)}
  60%{transform:translate(3px,-1px)}
  70%{transform:translate(-4px,2px)}
  80%{transform:translate(2px,-3px)}
  90%{transform:translate(-1px,1px)}
}
@keyframes sqShakeHard{
  0%,100%{transform:translate(0,0)}
  10%{transform:translate(-8px,4px) rotate(-1deg)}
  20%{transform:translate(6px,-6px) rotate(1deg)}
  30%{transform:translate(-6px,2px) rotate(-0.5deg)}
  40%{transform:translate(8px,-4px) rotate(1deg)}
  50%{transform:translate(-4px,6px)}
  60%{transform:translate(6px,-2px) rotate(-1deg)}
  70%{transform:translate(-8px,4px) rotate(0.5deg)}
  80%{transform:translate(4px,-6px)}
  90%{transform:translate(-2px,2px)}
}
body.sq-shake{animation:sqShake .4s ease;}
body.sq-shake-hard{animation:sqShakeHard .5s ease;}

/* ══ 플래시 ══ */
.sq-flash{
  position:fixed;inset:0;z-index:9998;pointer-events:none;
  opacity:0;transition:opacity .06s;
}
.sq-flash.on{opacity:1;}
.sq-flash.red{background:rgba(232,0,42,.45);}
.sq-flash.green{background:rgba(0,200,83,.35);}
.sq-flash.gold{background:rgba(255,214,0,.3);}
.sq-flash.white{background:rgba(255,255,255,.5);}
.sq-flash.blue{background:rgba(60,100,255,.3);}

/* ══ 줌 인/아웃 ══ */
body.sq-zoom-in{animation:sqZoomIn .4s ease forwards;}
body.sq-zoom-out{animation:sqZoomOut .4s ease forwards;}
@keyframes sqZoomIn{0%{transform:scale(1)}100%{transform:scale(1.05)}}
@keyframes sqZoomOut{0%{transform:scale(1.05)}100%{transform:scale(1)}}

/* ══ 슬로우 모션 ══ */
body.sq-slowmo *{
  transition-duration:1.5s !important;
  animation-duration:2s !important;
}
`;
    document.head.appendChild(style);
  }

  // ═══════════════════════════════════════
  // 🌦️ 날씨 시스템
  // ═══════════════════════════════════════
  const WEATHER_CONFIGS = {
    rain: {
      count: 120,
      create: (w, h) => ({
        x: Math.random() * w * 1.2 - w * 0.1,
        y: Math.random() * h * -1,
        speed: 8 + Math.random() * 12,
        length: 12 + Math.random() * 20,
        opacity: 0.15 + Math.random() * 0.25,
        wind: -1.5,
      }),
      draw: (ctx, p) => {
        ctx.strokeStyle = `rgba(174,194,224,${p.opacity})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + p.wind * 2, p.y + p.length);
        ctx.stroke();
      },
      update: (p, w, h) => {
        p.y += p.speed;
        p.x += p.wind;
        if (p.y > h + 20) { p.y = -p.length; p.x = Math.random() * w * 1.2 - w * 0.1; }
      },
      overlay: 'rgba(0,10,30,.15)',
    },
    snow: {
      count: 80,
      create: (w, h) => ({
        x: Math.random() * w,
        y: Math.random() * h * -1,
        speed: 0.8 + Math.random() * 2,
        radius: 1.5 + Math.random() * 3,
        opacity: 0.4 + Math.random() * 0.5,
        wobble: Math.random() * Math.PI * 2,
        wobbleSpeed: 0.01 + Math.random() * 0.02,
      }),
      draw: (ctx, p) => {
        ctx.fillStyle = `rgba(255,255,255,${p.opacity})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
        // 약간의 글로우
        ctx.fillStyle = `rgba(255,255,255,${p.opacity * 0.3})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius * 2, 0, Math.PI * 2);
        ctx.fill();
      },
      update: (p, w, h) => {
        p.wobble += p.wobbleSpeed;
        p.y += p.speed;
        p.x += Math.sin(p.wobble) * 0.5;
        if (p.y > h + 10) { p.y = -10; p.x = Math.random() * w; }
      },
      overlay: 'rgba(200,210,230,.08)',
    },
    wind: {
      count: 35,
      create: (w, h) => ({
        x: -50,
        y: Math.random() * h,
        speed: 6 + Math.random() * 10,
        length: 30 + Math.random() * 60,
        opacity: 0.04 + Math.random() * 0.08,
        curve: (Math.random() - 0.5) * 2,
      }),
      draw: (ctx, p) => {
        ctx.strokeStyle = `rgba(255,255,255,${p.opacity})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.quadraticCurveTo(p.x + p.length * 0.5, p.y + p.curve * 8, p.x + p.length, p.y + p.curve * 3);
        ctx.stroke();
      },
      update: (p, w, h) => {
        p.x += p.speed;
        p.y += p.curve * 0.3;
        if (p.x > w + 80) { p.x = -p.length; p.y = Math.random() * h; }
      },
      overlay: null,
    },
    sunny: {
      count: 6,
      create: (w, h) => ({
        x: Math.random() * w,
        y: -20,
        speed: 0,
        length: h * 1.2,
        opacity: 0.02 + Math.random() * 0.03,
        angle: -15 + Math.random() * 30,
        width: 30 + Math.random() * 60,
        phase: Math.random() * Math.PI * 2,
        phaseSpeed: 0.005 + Math.random() * 0.01,
      }),
      draw: (ctx, p) => {
        p.phase += p.phaseSpeed;
        const alpha = p.opacity * (0.5 + Math.sin(p.phase) * 0.5);
        const grad = ctx.createLinearGradient(p.x, p.y, p.x + p.width, p.y + p.length);
        grad.addColorStop(0, `rgba(255,240,180,${alpha})`);
        grad.addColorStop(0.5, `rgba(255,240,180,${alpha * 0.5})`);
        grad.addColorStop(1, 'rgba(255,240,180,0)');
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.angle * Math.PI) / 180);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, p.width, p.length);
        ctx.restore();
      },
      update: () => {},
      overlay: 'rgba(255,240,200,.04)',
    },
    stars: {
      count: 60,
      create: (w, h) => ({
        x: Math.random() * w,
        y: Math.random() * h * 0.45,
        speed: 0,
        radius: 0.5 + Math.random() * 1.8,
        opacity: 0.3 + Math.random() * 0.7,
        twinkleSpeed: 0.01 + Math.random() * 0.03,
        phase: Math.random() * Math.PI * 2,
        isShooting: false,
      }),
      draw: (ctx, p) => {
        if (p.isShooting) {
          // 별똥별
          const grad = ctx.createLinearGradient(p.x, p.y, p.x - p.tailLen, p.y - p.tailLen * 0.4);
          grad.addColorStop(0, `rgba(255,255,255,${p.opacity})`);
          grad.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.strokeStyle = grad;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.tailLen, p.y - p.tailLen * 0.4);
          ctx.stroke();
          ctx.fillStyle = `rgba(255,255,255,${p.opacity})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          p.phase += p.twinkleSpeed;
          const alpha = p.opacity * (0.4 + Math.sin(p.phase) * 0.6);
          ctx.fillStyle = `rgba(255,255,255,${alpha})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
          ctx.fill();
          // 글로우
          ctx.fillStyle = `rgba(255,255,255,${alpha * 0.15})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius * 4, 0, Math.PI * 2);
          ctx.fill();
        }
      },
      update: (p, w, h) => {
        if (p.isShooting) {
          p.x += p.shootSpeed;
          p.y += p.shootSpeed * 0.4;
          p.opacity -= 0.015;
          if (p.opacity <= 0 || p.x > w + 50 || p.y > h) {
            p.isShooting = false;
            p.x = Math.random() * w;
            p.y = Math.random() * h * 0.45;
            p.opacity = 0.3 + Math.random() * 0.7;
          }
        } else {
          // 랜덤 별똥별 발사
          if (Math.random() < 0.0003) {
            p.isShooting = true;
            p.shootSpeed = 5 + Math.random() * 8;
            p.tailLen = 40 + Math.random() * 60;
            p.opacity = 0.9;
          }
        }
      },
      overlay: null,
    },
  };

  let _weatherParticles = [];

  function weather(type) {
    // 중지
    if (!type || type === 'none' || type === 'clear') {
      cancelAnimationFrame(_weatherRAF);
      _currentWeather = null;
      _weatherParticles = [];
      if (_weatherCtx) _weatherCtx.clearRect(0, 0, _weatherCanvas.width, _weatherCanvas.height);
      return;
    }

    const config = WEATHER_CONFIGS[type];
    if (!config) return;

    cancelAnimationFrame(_weatherRAF);
    _currentWeather = type;
    const w = _weatherCanvas.width;
    const h = _weatherCanvas.height;

    _weatherParticles = [];
    for (let i = 0; i < config.count; i++) {
      _weatherParticles.push(config.create(w, h));
    }

    function loop() {
      _weatherCtx.clearRect(0, 0, w, h);

      // 오버레이
      if (config.overlay) {
        _weatherCtx.fillStyle = config.overlay;
        _weatherCtx.fillRect(0, 0, w, h);
      }

      _weatherParticles.forEach(p => {
        config.draw(_weatherCtx, p);
        config.update(p, w, h);
      });

      _weatherRAF = requestAnimationFrame(loop);
    }
    loop();
  }

  // ═══════════════════════════════════════
  // 💬 멘트 시스템
  // ═══════════════════════════════════════
  /**
   * 멘트 표시
   * @param {string} text - 표시할 텍스트
   * @param {object} opts - { type:'guard'|'system'|'player'|'danger', duration:2500, typing:false }
   */
  function announce(text, opts = {}) {
    _init();
    const { type = 'guard', duration = 2500, typing = false } = opts;
    const container = document.getElementById('sq-announce');

    const msg = document.createElement('div');
    msg.className = `sq-msg ${type}`;

    if (typing) {
      msg.textContent = '';
      container.appendChild(msg);
      let i = 0;
      const iv = setInterval(() => {
        if (i < text.length) {
          msg.textContent += text[i];
          i++;
        } else {
          clearInterval(iv);
          setTimeout(() => _removeMsg(msg), duration);
        }
      }, 50);
    } else {
      msg.textContent = text;
      container.appendChild(msg);
      setTimeout(() => _removeMsg(msg), duration);
    }

    return msg;
  }

  function _removeMsg(el) {
    el.classList.add('fade-out');
    setTimeout(() => el.remove(), 400);
  }

  /**
   * 대형 텍스트 (카운트다운, "탈락!", "클리어!" 등)
   */
  function bigText(text, duration = 1200) {
    _init();
    const el = document.createElement('div');
    el.className = 'sq-big-text';
    el.textContent = text;
    document.body.appendChild(el);

    vibrate([60, 30, 80]);

    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 500);
    }, duration);
  }

  // ═══════════════════════════════════════
  // ⚡ 이펙트
  // ═══════════════════════════════════════
  function flash(color = 'red', duration = 150) {
    _init();
    const layer = document.getElementById('sq-fx-layer');
    const f = document.createElement('div');
    f.className = `sq-flash ${color}`;
    layer.appendChild(f);
    requestAnimationFrame(() => {
      f.classList.add('on');
      setTimeout(() => {
        f.classList.remove('on');
        setTimeout(() => f.remove(), 100);
      }, duration);
    });
  }

  function shake(duration = 400, hard = false) {
    _init();
    const cls = hard ? 'sq-shake-hard' : 'sq-shake';
    document.body.classList.remove('sq-shake', 'sq-shake-hard');
    void document.body.offsetWidth; // 리플로우 트리거
    document.body.classList.add(cls);
    setTimeout(() => document.body.classList.remove(cls), duration);
  }

  function vignette(on = true, intense = false) {
    _init();
    const el = document.getElementById('sq-vignette');
    el.classList.toggle('active', on);
    el.classList.toggle('intense', intense);
  }

  function pulse(mode = 'active') {
    _init();
    const el = document.getElementById('sq-pulse');
    el.classList.remove('active', 'warning');
    if (mode) el.classList.add(mode);
  }

  function zoom(type = 'in', duration = 400) {
    _init();
    const cls = type === 'in' ? 'sq-zoom-in' : 'sq-zoom-out';
    document.body.classList.remove('sq-zoom-in', 'sq-zoom-out');
    void document.body.offsetWidth;
    document.body.classList.add(cls);
    setTimeout(() => document.body.classList.remove(cls), duration);
  }

  function slowmo(duration = 2000) {
    _init();
    document.body.classList.add('sq-slowmo');
    setTimeout(() => document.body.classList.remove('sq-slowmo'), duration);
  }

  // ═══════════════════════════════════════
  // 🎆 Canvas 파티클 (탈락/클리어)
  // ═══════════════════════════════════════
  let _pfxList = [];
  let _pfxRAF = null;

  function particles(type = 'clear', opts = {}) {
    _init();
    const canvas = document.getElementById('sq-particle-canvas');
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    const cx = opts.x || w / 2, cy = opts.y || h / 2;
    const count = opts.count || (type === 'clear' ? 50 : 30);

    const CONFIGS = {
      clear: { colors: ['#ffd600', '#ffab00', '#ff6d00', '#00e676', '#fff'], gravity: 0.12, life: 80, speed: 8, size: [3, 7] },
      fail: { colors: ['#e8002a', '#ff1a42', '#8b0000', '#ff4466', '#440000'], gravity: 0.08, life: 60, speed: 5, size: [2, 5] },
      blood: { colors: ['#8b0000', '#b71c1c', '#e8002a', '#4a0000'], gravity: 0.2, life: 45, speed: 4, size: [2, 4] },
      firework: { colors: ['#ffd600', '#ff6d00', '#e8002a', '#00e676', '#4db8ff', '#fff'], gravity: 0.06, life: 70, speed: 10, size: [2, 5] },
      dust: { colors: ['rgba(200,180,150,0.6)', 'rgba(180,160,120,0.4)', 'rgba(160,140,100,0.3)'], gravity: 0.02, life: 100, speed: 2, size: [1, 3] },
    };

    const cfg = CONFIGS[type] || CONFIGS.clear;

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = cfg.speed * (0.3 + Math.random() * 0.7);
      _pfxList.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (type === 'firework' ? 3 : 0),
        life: cfg.life,
        maxLife: cfg.life,
        gravity: cfg.gravity,
        color: cfg.colors[Math.floor(Math.random() * cfg.colors.length)],
        size: cfg.size[0] + Math.random() * (cfg.size[1] - cfg.size[0]),
        rotation: Math.random() * 360,
        rotSpeed: (Math.random() - 0.5) * 10,
      });
    }

    if (!_pfxRAF) _runParticles();
  }

  function _runParticles() {
    const canvas = document.getElementById('sq-particle-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    _pfxList = _pfxList.filter(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.gravity;
      p.vx *= 0.99;
      p.life--;
      p.rotation += p.rotSpeed;

      const alpha = Math.max(0, p.life / p.maxLife);

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rotation * Math.PI) / 180);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      ctx.restore();

      return p.life > 0 && p.y < h + 20;
    });

    if (_pfxList.length > 0) {
      _pfxRAF = requestAnimationFrame(_runParticles);
    } else {
      _pfxRAF = null;
      ctx.clearRect(0, 0, w, h);
    }
  }

  // ═══════════════════════════════════════
  // 📳 진동
  // ═══════════════════════════════════════
  function vibrate(pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) {}
  }

  // ═══════════════════════════════════════
  // 🎬 복합 연출 (자주 쓰는 조합)
  // ═══════════════════════════════════════
  
  /** 게임 시작 인트로 */
  function introSequence(gameName, callback) {
    _init();
    vignette(true);
    weather('wind');

    setTimeout(() => {
      announce('참가자 여러분, 주목하십시오.', { type: 'system', duration: 2500, typing: true });
    }, 500);

    setTimeout(() => {
      bigText(gameName, 1800);
      vibrate([100, 50, 100, 50, 200]);
    }, 3200);

    setTimeout(() => {
      announce('게임을 시작하겠습니다.', { type: 'guard', duration: 2000, typing: true });
    }, 5200);

    setTimeout(() => {
      vignette(false);
      if (callback) callback();
    }, 7500);
  }

  /** 탈락 연출 */
  function eliminateEffect(opts = {}) {
    _init();
    const x = opts.x || window.innerWidth / 2;
    const y = opts.y || window.innerHeight / 2;

    flash('red', 200);
    shake(500, true);
    vibrate([100, 50, 100, 50, 200]);
    particles('fail', { x, y, count: 35 });

    setTimeout(() => {
      announce('탈락', { type: 'danger', duration: 2000 });
      flash('red', 120);
    }, 300);
  }

  /** 클리어 연출 */
  function clearEffect() {
    _init();
    flash('gold', 250);
    shake(300);
    vibrate([80, 40, 80, 40, 250]);

    const w = window.innerWidth;
    const h = window.innerHeight;
    particles('firework', { x: w * 0.3, y: h * 0.4, count: 30 });
    setTimeout(() => particles('firework', { x: w * 0.7, y: h * 0.35, count: 30 }), 200);
    setTimeout(() => particles('clear', { x: w * 0.5, y: h * 0.5, count: 40 }), 400);

    setTimeout(() => {
      announce('축하합니다! 통과!', { type: 'system', duration: 3000 });
    }, 500);
  }

  /** AI 탈락 연출 (경량) */
  function aiElimEffect(x, y) {
    _init();
    particles('blood', { x, y, count: 12 });
    vibrate(40);
  }

  /** 타이머 위급 연출 */
  function timerUrgent(secondsLeft) {
    _init();
    if (secondsLeft <= 5) {
      pulse('warning');
      vignette(true, true);
      flash('red', 80);
      vibrate([60, 30, 60]);
    } else if (secondsLeft <= 10) {
      pulse('active');
      vignette(true, false);
      vibrate(30);
    }
  }

  /** 빨간불 전환 */
  function redLightEffect() {
    _init();
    flash('red', 180);
    shake(250);
    vibrate([60, 40, 80]);
  }

  /** 초록불 전환 */
  function greenLightEffect() {
    _init();
    flash('green', 120);
    vibrate(40);
  }

  // ═══════════════════════════════════════
  // 🔧 유틸
  // ═══════════════════════════════════════
  function cleanup() {
    weather('none');
    vignette(false);
    pulse(null);
    _pfxList = [];
    const announce = document.getElementById('sq-announce');
    if (announce) announce.innerHTML = '';
  }

  // ═══════════════════════════════════════
  // 자동 초기화
  // ═══════════════════════════════════════
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }

  // ═══════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════
  return {
    // 날씨
    weather,          // SQ.weather('rain'|'snow'|'wind'|'sunny'|'stars'|'none')

    // 멘트
    announce,         // SQ.announce('텍스트', {type,duration,typing})
    bigText,          // SQ.bigText('탈락!', 1200)

    // 이펙트
    flash,            // SQ.flash('red'|'green'|'gold'|'white'|'blue', ms)
    shake,            // SQ.shake(400, hard?)
    vignette,         // SQ.vignette(true/false, intense?)
    pulse,            // SQ.pulse('active'|'warning'|null)
    zoom,             // SQ.zoom('in'|'out', ms)
    slowmo,           // SQ.slowmo(2000)
    particles,        // SQ.particles('clear'|'fail'|'blood'|'firework'|'dust', {x,y,count})
    vibrate,          // SQ.vibrate([100,50,100])

    // 복합 연출
    introSequence,    // SQ.introSequence('무궁화 꽃이 피었습니다', callback)
    eliminateEffect,  // SQ.eliminateEffect({x,y})
    clearEffect,      // SQ.clearEffect()
    aiElimEffect,     // SQ.aiElimEffect(x,y)
    timerUrgent,      // SQ.timerUrgent(secondsLeft)
    redLightEffect,   // SQ.redLightEffect()
    greenLightEffect, // SQ.greenLightEffect()

    // 유틸
    cleanup,          // SQ.cleanup()
  };
})();
