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

/*********************
 * Sets routes to the pages to be rendered (the home landing page, about page, and projects pages). The projects
 * pages in project.pug receive data from data.json relative to the specific project that has been selected (thisProject)
 * and then dynamically render that information on screen. 
*********************/

app.get('/', (req, res) => {
    const projects = data.projects;
    const templateData = { projects };
    res.render('index', templateData);
})

app.get('/about', (req, res) => {
    res.render('about');
})

app.get('/project/:id', (req, res, next) => {
    const id = req.params.id;
    const thisProject = data.projects[id];
    const templateData = { thisProject };
    res.render('project', templateData);
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