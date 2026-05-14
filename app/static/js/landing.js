(function () {
  "use strict";

  const stageIconHost = document.querySelector(".landing-vault-center");
  const stageLabelEl = document.querySelector("[data-stage-label]");
  const stageStepEl = document.querySelector("[data-stage-step]");
  const progressFillEl = document.querySelector("[data-progress-fill]");
  const halo = document.querySelector(".landing-vault-halo");
  const ring = document.querySelector(".landing-vault-ring");
  const ringInner = document.querySelector(".landing-vault-ring-inner");
  const steps = Array.prototype.slice.call(document.querySelectorAll(".landing-step"));
  const visual = document.querySelector("[data-story-visual]");
  if (!stageIconHost || !stageLabelEl || !progressFillEl || !steps.length) return;

  const stageMap = [
    { key: "locked",  icon: "lock",   label: "Vault locked",       progress: 0.08 },
    { key: "auth",    icon: "shield", label: "Authenticating",     progress: 0.38 },
    { key: "decrypt", icon: "key",    label: "Decrypting vault",   progress: 0.74 },
    { key: "open",    icon: "unlock", label: "Vault unlocked",     progress: 1.00 }
  ];

  let currentStageIndex = -1;
  const totalSteps = stageMap.length;

  function renderIcon(iconName) {
    if (!(window.feather && window.feather.icons && window.feather.icons[iconName])) return;
    stageIconHost.innerHTML = window.feather.icons[iconName].toSvg({
      "class": "landing-stage-icon",
      "data-stage-icon": "",
      "aria-hidden": "true"
    });
  }

  function setStepText(index) {
    if (!stageStepEl) return;
    stageStepEl.textContent = "Step " + (index + 1) + " / " + totalSteps;
  }

  function setStage(index, animated) {
    const safeIndex = Math.max(0, Math.min(stageMap.length - 1, index));
    if (safeIndex === currentStageIndex) return;
    currentStageIndex = safeIndex;
    const stage = stageMap[safeIndex];

    if (animated && window.gsap) {
      window.gsap.to(progressFillEl, {
        scaleX: stage.progress,
        duration: 0.7,
        ease: "power3.out",
        transformOrigin: "left center"
      });

      window.gsap.to(stageLabelEl, {
        y: -6,
        autoAlpha: 0,
        duration: 0.16,
        ease: "power1.in",
        onComplete: function () {
          stageLabelEl.textContent = stage.label;
          window.gsap.fromTo(stageLabelEl, { y: 6, autoAlpha: 0 }, {
            y: 0, autoAlpha: 1, duration: 0.32, ease: "power3.out"
          });
        }
      });

      const currentIcon = stageIconHost.querySelector("[data-stage-icon]");
      if (currentIcon) {
        window.gsap.to(currentIcon, {
          scale: 0.84,
          autoAlpha: 0,
          duration: 0.18,
          ease: "power2.in",
          onComplete: function () {
            renderIcon(stage.icon);
            const nextIcon = stageIconHost.querySelector("[data-stage-icon]");
            if (!nextIcon) return;
            window.gsap.fromTo(nextIcon, { scale: 0.86, autoAlpha: 0 }, {
              scale: 1, autoAlpha: 1, duration: 0.36, ease: "power3.out"
            });
          }
        });
      } else {
        renderIcon(stage.icon);
      }

      if (halo) {
        const haloIntensity = 0.7 + safeIndex * 0.08;
        window.gsap.to(halo, {
          opacity: haloIntensity,
          scale: 1 + safeIndex * 0.04,
          duration: 0.65,
          ease: "power2.out",
          transformOrigin: "50% 50%"
        });
      }
    } else {
      stageLabelEl.textContent = stage.label;
      progressFillEl.style.transform = "scaleX(" + stage.progress + ")";
      renderIcon(stage.icon);
    }

    setStepText(safeIndex);

    steps.forEach(function (step, stepIndex) {
      const active = stepIndex === safeIndex;
      step.classList.toggle("is-active", active);
    });
  }

  setStage(0, false);

  const reducedMotion = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reducedMotion || !window.gsap || !window.ScrollTrigger) {
    setStage(stageMap.length - 1, false);
    steps.forEach(function (step) { step.classList.add("is-active"); });
    return;
  }

  window.gsap.registerPlugin(window.ScrollTrigger);

  if (ring) {
    window.gsap.to(ring, {
      rotate: 360,
      ease: "none",
      scrollTrigger: {
        trigger: "#unlock-story",
        start: "top 78%",
        end: "bottom 25%",
        scrub: 1.1
      }
    });
  }

  if (ringInner) {
    window.gsap.to(ringInner, {
      rotate: -180,
      ease: "none",
      scrollTrigger: {
        trigger: "#unlock-story",
        start: "top 78%",
        end: "bottom 25%",
        scrub: 1.4
      }
    });
  }

  steps.forEach(function (step, index) {
    window.ScrollTrigger.create({
      trigger: step,
      start: "top 70%",
      end: "bottom 45%",
      onEnter: function () { setStage(index, true); },
      onEnterBack: function () { setStage(index, true); }
    });
  });

  if (visual) {
    window.gsap.fromTo(visual,
      { y: 24, autoAlpha: 0.6 },
      {
        y: 0,
        autoAlpha: 1,
        duration: 0.6,
        ease: "power2.out",
        scrollTrigger: {
          trigger: visual,
          start: "top 90%",
          toggleActions: "play none none reverse"
        }
      }
    );
  }
})();
