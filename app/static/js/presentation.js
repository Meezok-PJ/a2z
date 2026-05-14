(function () {
  "use strict";
  var stage = document.getElementById("pres-stage");
  var slides = Array.prototype.slice.call(stage.querySelectorAll(".pres-slide"));
  var counter = document.getElementById("pres-counter");
  var prevBtn = document.getElementById("pres-prev");
  var nextBtn = document.getElementById("pres-next");
  var dotsWrap = document.getElementById("pres-dots");
  var current = 0;
  var total = slides.length;
  var animating = false;

  // Build dots
  for (var i = 0; i < total; i++) {
    var dot = document.createElement("button");
    dot.className = "pres-dot" + (i === 0 ? " active" : "");
    dot.setAttribute("aria-label", "Go to slide " + (i + 1));
    dot.setAttribute("data-dot", String(i));
    dotsWrap.appendChild(dot);
  }
  var dots = Array.prototype.slice.call(dotsWrap.querySelectorAll(".pres-dot"));

  function updateCounter() {
    counter.textContent = (current + 1) + " / " + total;
  }

  function goTo(index) {
    if (animating || index === current || index < 0 || index >= total) return;
    animating = true;
    var dir = index > current ? 1 : -1;
    var leaving = slides[current];
    var entering = slides[index];

    // Set entering initial state
    entering.style.transform = "translateX(" + (dir * 100) + "%)";
    entering.style.opacity = "0";
    entering.classList.add("pres-slide--active");

    // Animate with GSAP
    if (window.gsap) {
      var tl = gsap.timeline({
        onComplete: function () {
          leaving.classList.remove("pres-slide--active");
          leaving.style.transform = "";
          leaving.style.opacity = "";
          animating = false;
          animateSlideContent(entering);
        }
      });
      tl.to(leaving, { x: dir * -100 + "%", opacity: 0, duration: 0.5, ease: "power2.inOut" }, 0);
      tl.to(entering, { x: "0%", opacity: 1, duration: 0.5, ease: "power2.inOut" }, 0);
    } else {
      leaving.classList.remove("pres-slide--active");
      entering.style.transform = "translateX(0)";
      entering.style.opacity = "1";
      animating = false;
    }

    current = index;
    updateCounter();
    dots.forEach(function (d, di) { d.classList.toggle("active", di === current); });
  }

  function next() { goTo(current + 1); }
  function prev() { goTo(current - 1); }

  prevBtn.addEventListener("click", prev);
  nextBtn.addEventListener("click", next);

  dotsWrap.addEventListener("click", function (e) {
    var dot = e.target.closest("[data-dot]");
    if (!dot) return;
    goTo(Number(dot.getAttribute("data-dot")));
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); next(); }
    if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
  });

  // Touch swipe
  var touchStartX = 0;
  stage.addEventListener("touchstart", function (e) { touchStartX = e.touches[0].clientX; }, { passive: true });
  stage.addEventListener("touchend", function (e) {
    var diff = touchStartX - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) { diff > 0 ? next() : prev(); }
  });

  // Animate content appearing on slide
  function animateSlideContent(slide) {
    if (!window.gsap) return;
    var children = Array.prototype.slice.call(slide.querySelectorAll(".pres-card, .pres-split-item, .pres-code-block, .pres-seq-flow, .pres-dfd-node, .pres-dfd-boundary"));
    if (!children.length) return;
    gsap.from(children, {
      y: 30, opacity: 0, duration: 0.45, stagger: 0.08, ease: "power2.out", delay: 0.2
    });
  }

  // Initial slide animation
  animateSlideContent(slides[0]);
  updateCounter();
})();
