// Immediately make all timeline items visible when the page loads
document.addEventListener('DOMContentLoaded', function() {
  console.log('Timeline script loaded - v3 with touch improvements');
  
  // Force a CSS refresh by adding and removing a class
  document.body.classList.add('force-repaint');
  setTimeout(() => {
    document.body.classList.remove('force-repaint');
  }, 10);
  
  // Get all timeline items
  const timelineItems = document.querySelectorAll('.timeline-item');
  console.log('Timeline items found:', timelineItems.length);
  
  // Detect if device is touch-enabled
  const isTouchDevice = ('ontouchstart' in window) || 
                        (navigator.maxTouchPoints > 0) || 
                        (navigator.msMaxTouchPoints > 0);
  console.log('Touch device detected:', isTouchDevice);
  
  // Function to check if an element is in viewport with additional margin for mobile
  function isInViewport(element) {
    const rect = element.getBoundingClientRect();
    // Add extra margin for mobile devices to trigger animations earlier
    const margin = isTouchDevice ? window.innerHeight * 0.2 : 0;
    return (
      rect.top >= -margin &&
      rect.left >= 0 &&
      rect.bottom <= (window.innerHeight + margin || document.documentElement.clientHeight + margin) &&
      rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    );
  }
  
  // Function to handle scroll animation
  function handleScroll() {
    timelineItems.forEach((item, index) => {
      if (isInViewport(item)) {
        // Add a delay based on the index for cascading effect
        setTimeout(() => {
          item.classList.add('visible');
        }, index * 100);
      }
    });
  }
  
  // Initial check for items in viewport
  function initTimeline() {
    console.log('Initializing timeline with cascading effect');
    
    // First make all items visible with a cascading effect
    timelineItems.forEach((item, index) => {
      // Remove any existing visible class
      item.classList.remove('visible');
      
      setTimeout(() => {
        item.classList.add('visible');
        console.log('Made item visible:', index);
      }, index * 100);
    });
    
    // Add interaction effects for timeline dots
    timelineItems.forEach(item => {
      const dot = item.querySelector('.timeline-dot');
      if (dot) {
        // Add pulse animation on hover for non-touch devices
        if (!isTouchDevice) {
          dot.addEventListener('mouseenter', function() {
            this.style.animation = 'pulse 1.5s infinite';
          });
          
          dot.addEventListener('mouseleave', function() {
            this.style.animation = '';
          });
        } else {
          // For touch devices, add tap/touch feedback
          dot.addEventListener('touchstart', function(e) {
            this.style.animation = 'pulse 1.5s infinite';
            // Prevent default to avoid scrolling when tapping
            e.preventDefault();
          }, { passive: false });
          
          dot.addEventListener('touchend', function() {
            setTimeout(() => {
              this.style.animation = '';
            }, 1500); // Keep animation for 1.5s after touch
          });
        }
      }
      
      // Make timeline content interactive on touch
      const content = item.querySelector('.timeline-content');
      if (content && isTouchDevice) {
        content.addEventListener('touchstart', function() {
          this.classList.add('touch-active');
        }, { passive: true });
        
        content.addEventListener('touchend', function() {
          setTimeout(() => {
            this.classList.remove('touch-active');
          }, 300);
        });
      }
    });
  }
  
  // Add smooth scrolling for timeline container with improved touch handling
  const timelineContainer = document.querySelector('.timeline-container');
  if (timelineContainer) {
    // For mouse scroll
    timelineContainer.addEventListener('scroll', function() {
      requestAnimationFrame(handleScroll);
    });
    
    // For touch scroll events
    if (isTouchDevice) {
      let touchStartY = 0;
      let touchEndY = 0;
      
      timelineContainer.addEventListener('touchstart', function(e) {
        touchStartY = e.changedTouches[0].screenY;
      }, { passive: true });
      
      timelineContainer.addEventListener('touchend', function(e) {
        touchEndY = e.changedTouches[0].screenY;
        // If significant scroll happened, check for new items in viewport
        if (Math.abs(touchStartY - touchEndY) > 20) {
          requestAnimationFrame(handleScroll);
        }
      }, { passive: true });
    }
  }
  
  // Initialize timeline
  initTimeline();
  
  // Add keyframe animation for pulse effect
  const style = document.createElement('style');
  style.textContent = `
    @keyframes pulse {
      0% {
        box-shadow: 0 0 0 0 rgba(var(--accent-rgb), 0.7);
        transform: scale(1);
      }
      70% {
        box-shadow: 0 0 0 10px rgba(var(--accent-rgb), 0);
        transform: scale(1.2);
      }
      100% {
        box-shadow: 0 0 0 0 rgba(var(--accent-rgb), 0);
        transform: scale(1);
      }
    }
    
    /* Force browser to repaint */
    .force-repaint {
      transform: translateZ(0);
    }
    
    /* Touch active state for timeline content */
    .timeline-content.touch-active {
      transform: translateY(-5px);
      box-shadow: 0 0 20px rgba(99, 102, 241, 0.2), 0 0 30px rgba(99, 102, 241, 0.1);
      transition: all 0.3s ease;
    }
  `;
  document.head.appendChild(style);
  
  // Handle tab switching with improved touch support
  const tabs = document.querySelectorAll('.portfolio-tab');
  console.log('Tabs found:', tabs.length);
  
  tabs.forEach(tab => {
    // Use both click and touch events
    ['click', 'touchend'].forEach(eventType => {
      tab.addEventListener(eventType, function(e) {
        // Prevent default only for click to avoid double triggering on touch devices
        if (eventType === 'click') {
          e.preventDefault();
        }
        
        console.log('Tab ' + eventType + ':', this.textContent);
        
        // Get the tab name from the data attribute or text content
        const tabName = this.getAttribute('data-tab') || this.textContent.toLowerCase().trim();
        console.log('Tab name:', tabName);
        
        // Update active tab
        tabs.forEach(t => t.classList.remove('active'));
        this.classList.add('active');
        
        // Get all content sections
        const contents = document.querySelectorAll('.portfolio-content');
        console.log('Content sections found:', contents.length);
        
        // Hide all content sections
        contents.forEach(content => {
          content.style.display = 'none';
        });
        
        // Show the selected content section
        const targetContent = document.querySelector(`.portfolio-content[data-content="${tabName}"]`);
        console.log('Target content found:', targetContent ? 'yes' : 'no');
        
        if (targetContent) {
          targetContent.style.display = 'block';
          console.log('Displayed content for tab:', tabName);
          
          // If switching to timeline tab, reinitialize it
          if (tabName === 'timeline') {
            // Short delay to ensure the tab content is visible
            setTimeout(initTimeline, 50);
          }
        }
      }, eventType === 'touchend' ? { passive: true } : false);
    });
  });
  
  // Also handle tab switching on the main page if those tabs exist
  const portfolioTabs = document.querySelectorAll('.portfolio-tab');
  const portfolioContents = document.querySelectorAll('.portfolio-content');
  
  if (portfolioTabs.length > 0 && portfolioContents.length > 0) {
    console.log('Portfolio tabs found:', portfolioTabs.length);
    
    portfolioTabs.forEach(tab => {
      // Use both click and touch events for better mobile support
      ['click', 'touchend'].forEach(eventType => {
        tab.addEventListener(eventType, function(e) {
          // Prevent default only for click to avoid double triggering on touch devices
          if (eventType === 'click') {
            e.preventDefault();
          }
          
          const tabName = this.getAttribute('data-tab');
          console.log('Portfolio tab ' + eventType + ':', tabName);
          
          // Update active tab
          portfolioTabs.forEach(t => t.classList.remove('active'));
          this.classList.add('active');
          
          // Hide all content sections
          portfolioContents.forEach(content => {
            content.style.display = 'none';
          });
          
          // Show the selected content section
          const targetContent = document.querySelector(`.portfolio-content[data-content="${tabName}"]`);
          if (targetContent) {
            targetContent.style.display = 'block';
          }
        }, eventType === 'touchend' ? { passive: true } : false);
      });
    });
    
    // Set the first tab as active by default
    if (portfolioTabs.length > 0 && !document.querySelector('.portfolio-tab.active')) {
      portfolioTabs[0].classList.add('active');
      const firstTabName = portfolioTabs[0].getAttribute('data-tab');
      const firstContent = document.querySelector(`.portfolio-content[data-content="${firstTabName}"]`);
      if (firstContent) {
        firstContent.style.display = 'block';
      }
    }
  }
}); 