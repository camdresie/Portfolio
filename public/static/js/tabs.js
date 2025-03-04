// Simple tab switching functionality
document.addEventListener('DOMContentLoaded', function() {
    console.log('Tabs.js loaded');
    
    // Get all tabs and content sections
    const tabs = document.querySelectorAll('.portfolio-tab');
    console.log('Found tabs:', tabs.length);
    
    // Add click event to each tab
    tabs.forEach(tab => {
        tab.addEventListener('click', function(e) {
            e.preventDefault();
            
            // Get tab name from data attribute
            const tabName = this.getAttribute('data-tab');
            console.log('Tab clicked:', tabName);
            
            // Remove active class from all tabs
            tabs.forEach(t => t.classList.remove('active'));
            
            // Add active class to clicked tab
            this.classList.add('active');
            
            // Hide all content sections
            const contents = document.querySelectorAll('.portfolio-content');
            contents.forEach(content => {
                content.style.display = 'none';
            });
            
            // Show the selected content section
            const targetContent = document.querySelector(`.portfolio-content[data-content="${tabName}"]`);
            if (targetContent) {
                targetContent.style.display = 'block';
                console.log('Showing content for tab:', tabName);
            }
        });
    });
}); 