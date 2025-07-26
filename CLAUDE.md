# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Node.js portfolio website for Cam Dresie that showcases dual expertise in Product Management and Software Engineering. The site features a sophisticated dual-portfolio system with dynamic content rendering, responsive design, and professional project showcasing.

## Key Commands

```bash
# Start development server
npm start                    # Runs on port 5001 (localhost:5001)

# No build process - static assets served directly from /public
# No test framework currently configured
```

## Architecture

### Dual Portfolio System
The site presents two distinct portfolio types through a unified interface:

- **Product Management Portfolio**: Business-focused projects emphasizing team leadership, strategic impact, and business outcomes
- **Engineering Portfolio**: Technical projects with live demos, GitHub links, and implementation details

### Core Components

**Data Layer** (`data.json`):
- `projects[]`: Engineering projects with categories (passion, ai, web, ios, games)
- `categories[]`: Category definitions for engineering projects  
- `pmProjects.categories[]`: PM project categories (New Product Development, AI/ML Solutions, Digital Transformation Tools)

**Routing System** (`app.js`):
```javascript
// Intelligent project routing based on ID prefix
app.get('/project/:id', (req, res) => {
  if (projectId.startsWith('pm-')) {
    // Render PM project with pm-project.pug
  } else {
    // Render engineering project with project.pug
  }
});
```

**Template System** (`views/`):
- `layout.pug`: Base template with navigation and styling
- `index.pug`: Home page with tabbed dual portfolio display
- `about.pug`: Professional timeline and bio with tab system
- `project.pug`: Engineering project detail pages
- `pm-project.pug`: Product management project detail pages

### Frontend Architecture

**Tab System**: Dynamic content switching between PM and Engineering portfolios with URL parameter support for deep linking.

**Image Galleries**: Touch-enabled galleries with swipe navigation for mobile devices.

**Timeline Visualization**: Professional timeline on about page with alternating layout and scroll animations.

## Data Schemas

### Engineering Project Structure
```json
{
  "id": "string",
  "category": "passion|ai|web|ios|games", 
  "project_name": "string",
  "description": "string",
  "technologies": ["array of strings"],
  "github_link": "optional URL",
  "live_link": "optional URL", 
  "image_urls": ["array of image paths"]
}
```

### PM Project Structure  
```json
{
  "id": "pm-prefix-required",
  "project_name": "string",
  "description": "string", 
  "timeline": "string",
  "role": "string",
  "team": "string",
  "overview": "string",
  "approach": [{"title": "string", "description": "string"}],
  "outcomes": ["array of strings"],
  "technologies": ["array of strings"],
  "image_urls": {"thumbnail": "string", "gallery": ["array"]},
  "images": [{"url": "string", "caption": "string"}]
}
```

## Adding New Projects

### Engineering Projects
1. Add project object to `data.json` projects array
2. Assign appropriate category from existing categories
3. Add project images to `/public/images/ProjectName/` directory
4. Reference images using `./static/images/ProjectName/filename.ext` paths

### PM Projects  
1. Add project object to appropriate category in `pmProjects.categories[].projects`
2. Use `pm-` prefix for project ID (required for correct routing)
3. Include business metrics and team information
4. Add project images to `/public/images/ProjectName/` directory

## Static Assets

**CSS Architecture**:
- `/public/css/style.css`: Main styles with CSS custom properties
- `/public/css/foundation.css`: Foundation framework base
- Dark theme with blue accent color (#00a6ff)

**Image Organization**:
- Project images: `/public/images/ProjectName/`
- Naming: `project0square.jpg` for thumbnails, numbered for galleries
- Profile image: `/public/images/profile_picture.jpg`

**JavaScript**:
- `/public/js/scripts.js`: Main site functionality
- `/public/js/slideshow.js`: Image gallery functionality  
- `/public/js/tabs.js`: Tab system functionality

## Development Notes

### Template Inheritance
All pages extend `layout.pug` which provides:
- Common HTML structure and meta tags
- Navigation bar
- Foundation CSS and custom stylesheets
- JavaScript includes

### Responsive Design
- Foundation framework provides responsive grid system
- Custom CSS handles mobile-specific timeline layout
- Touch gestures supported for image galleries

### Error Handling
- 404 middleware redirects to custom error page
- Graceful fallbacks for missing project data
- Image loading error handling in galleries

## Deployment

The application is configured for Heroku deployment:
- Uses `process.env.PORT` with fallback to 5001
- Static assets served via Express static middleware
- No build process required - files served directly

## Portfolio Content Strategy

**Engineering Section**: Demonstrates technical depth with working demos and clean code architecture.

**PM Section**: Emphasizes business impact, team leadership, and strategic thinking with quantified outcomes.

**About Page**: Professional timeline highlighting career progression from law to engineering to product management, showcasing unique interdisciplinary background.