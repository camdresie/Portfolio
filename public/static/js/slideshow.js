let touchStartX = 0;
let touchEndX = 0;
let currentSlideIndex = 0;
const slides = document.querySelectorAll('.slide');
const dots = document.querySelectorAll('.dot');

// Initialize the slideshow
function initSlideshow() {
  if (!slides.length) return;
  currentSlideIndex = 0;
  showSlide(currentSlideIndex);

  // Add touch event listeners
  const slideshow = document.querySelector('.slideshow-container');
  if (slideshow) {
    slideshow.addEventListener('touchstart', handleTouchStart, false);
    slideshow.addEventListener('touchmove', handleTouchMove, false);
    slideshow.addEventListener('touchend', handleTouchEnd, false);
  }
}

// Handle touch start
function handleTouchStart(event) {
  touchStartX = event.touches[0].clientX;
}

// Handle touch move
function handleTouchMove(event) {
  touchEndX = event.touches[0].clientX;
}

// Handle touch end
function handleTouchEnd() {
  const touchDiff = touchStartX - touchEndX;
  
  // Require a minimum swipe distance to trigger slide change
  if (Math.abs(touchDiff) > 50) {
    if (touchDiff > 0) {
      // Swipe left - show next slide
      changeSlide(1);
    } else {
      // Swipe right - show previous slide
      changeSlide(-1);
    }
  }
  
  // Reset touch coordinates
  touchStartX = 0;
  touchEndX = 0;
}

function changeSlide(direction) {
  if (!slides.length) return;
  
  currentSlideIndex += direction;
  
  // Handle wrapping around
  if (currentSlideIndex >= slides.length) {
    currentSlideIndex = 0;
  }
  if (currentSlideIndex < 0) {
    currentSlideIndex = slides.length - 1;
  }
  
  showSlide(currentSlideIndex);
}

function currentSlide(index) {
  if (!slides.length) return;
  currentSlideIndex = index;
  showSlide(currentSlideIndex);
}

function showSlide(index) {
  // Hide all slides
  slides.forEach(slide => {
    slide.classList.remove('active');
  });
  
  // Show the current slide
  slides[index].classList.add('active');
  
  // Update dots if they exist
  if (dots.length) {
    dots.forEach(dot => {
      dot.classList.remove('active');
    });
    dots[index].classList.add('active');
  }
}

// Initialize slideshow when DOM is loaded
document.addEventListener('DOMContentLoaded', initSlideshow); 