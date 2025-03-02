let currentSlideIndex = 0;

function changeSlide(n) {
  showSlide(currentSlideIndex + n);
}

function currentSlide(n) {
  showSlide(n);
}

function showSlide(n) {
  const slides = document.getElementsByClassName('slide');
  const dots = document.getElementsByClassName('dot');
  
  if (!slides.length) return;
  
  // Handle wrapping
  if (n >= slides.length) {
    currentSlideIndex = 0;
  } else if (n < 0) {
    currentSlideIndex = slides.length - 1;
  } else {
    currentSlideIndex = n;
  }
  
  // Hide all slides
  for (let i = 0; i < slides.length; i++) {
    slides[i].classList.remove('active');
    if (dots[i]) {
      dots[i].classList.remove('active');
    }
  }
  
  // Show current slide
  slides[currentSlideIndex].classList.add('active');
  if (dots[currentSlideIndex]) {
    dots[currentSlideIndex].classList.add('active');
  }
}

// Initialize the first slide
document.addEventListener('DOMContentLoaded', () => {
  showSlide(0);
}); 