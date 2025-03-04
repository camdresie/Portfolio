document.addEventListener('DOMContentLoaded', function() {
    const tabs = document.querySelectorAll('.portfolio-tab');
    const contents = document.querySelectorAll('.portfolio-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
            e.preventDefault();
            
            // Remove active class from all tabs
            tabs.forEach(t => t.classList.remove('active'));
            
            // Add active class to clicked tab
            tab.classList.add('active');
            
            // Hide all content sections
            contents.forEach(content => {
                content.classList.add('hidden');
                content.classList.remove('transitioning');
            });
            
            // Show the selected content section
            const targetContent = document.querySelector(`[data-content="${tab.dataset.tab}"]`);
            if (targetContent) {
                targetContent.classList.remove('hidden');
                // Add transitioning class for animation
                setTimeout(() => {
                    targetContent.classList.add('transitioning');
                }, 50);
            }
        });
    });
}); 