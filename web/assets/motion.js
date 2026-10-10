// Scroll reveals. Elements get .rise, then .in when they enter the viewport. Without this script nothing is hidden.
document.documentElement.classList.add("js");
const targets = document.querySelectorAll(".hair, .split > *, .steps > div, .sponsors > div, .wrap > h2, .wrap > .panel, .marq, .stats > *, .feed");
const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add("in");
      io.unobserve(e.target);
    }
  },
  { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
);
for (const el of targets) {
  if (el.closest(".heroGrid")) continue;
  el.style.setProperty("--i", [...el.parentElement.children].indexOf(el) % 6);
  el.classList.add("rise");
  io.observe(el);
}
