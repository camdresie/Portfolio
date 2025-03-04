/*********************
 * Variables for the necessary dependencies
*********************/

const express = require("express");
const app = express();
const data = require("./data.json");

/*********************
 * Sets Pug as the view engine
*********************/

app.set('view engine', 'pug');

/*********************
 * Sets up static server to supply CSS files. 
*********************/

app.use('/static', express.static('public'));
app.use(express.static('public'));

/*********************
 * Sets routes to the pages to be rendered (the home landing page, about page, and projects pages). The projects
 * pages in project.pug receive data from data.json relative to the specific project that has been selected (thisProject)
 * and then dynamically render that information on screen. 
*********************/

app.get('/', (req, res) => {
    const { projects, categories, pmProjects } = data;
    res.render('index', { projects, categories, pmProjects });
})

app.get('/about', (req, res) => {
    res.render('about');
})

app.get('/project/:id', (req, res) => {
  const projectId = req.params.id;
  let project;

  // Check if it's a PM project
  if (projectId.startsWith('pm-')) {
    for (const category of data.pmProjects.categories) {
      project = category.projects.find(p => p.id === projectId);
      if (project) {
        return res.render('pm-project', { project });
      }
    }
  } else {
    // Handle engineering projects
    project = data.projects.find(p => p.id === projectId);
    if (project) {
      return res.render('project', { thisProject: project });
    }
  }

  // If no project found, return 404
  res.sendStatus(404);
});

/*********************
 * 404 Error Handler followed by a custom error handler that points 
 * to the error.pug file and renders it if an error occurs. 
*********************/

app.use((req, res, next) => {
    const err = new Error('Uh-oh! This page doesn\'t exist! Try again.');
    err.status = 404;
    next(err);
});

app.use((err, req, res, next) => {
    res.locals.error = err;
    res.render('error');
    res.status(err.status);
});

/*********************
 * The app listens on localhost:3000. The app will also run if a user enters 'npm start' in the terminal.
*********************/

app.listen(process.env.PORT || 5001, () => {
    console.log('The server is running!');
});