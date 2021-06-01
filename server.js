/*
This is the main server script that manages the app database and provides the API endpoints
- The script creates the SQLite database and adds two initial tables to it
- The endpoints connect to the db and return data to the page handlebars files
*/

// Utilities we need
const fs = require("fs");
const path = require("path");

// Initialize the database - you can create a db with a different filename
const dbFile = "./.data/choices.db";
const exists = fs.existsSync(dbFile);
const sqlite3 = require("sqlite3").verbose();
const dbWrapper = require("sqlite");
let db;

// We're using the sqlite wrapper so that we can use async/await
//https://www.npmjs.com/package/sqlite
dbWrapper
  .open({
    filename: dbFile,
    driver: sqlite3.Database
  })
  .then(async dBase => {
    db = dBase;
    try {
      if (!exists) {
        // Database doesn't exist yet - create Choices and Log tables
        await db.run(
          "CREATE TABLE Choices (id INTEGER PRIMARY KEY AUTOINCREMENT, language TEXT, picks INTEGER)"
        );
        // Add default choices to table
        await db.run(
          "INSERT INTO Choices (language, picks) VALUES ('HTML', 0), ('JavaScript', 0), ('CSS', 0)"
        );
        // Log can start empty - we'll insert a new record whenever the user chooses a poll option
        await db.run(
          "CREATE TABLE Log (id INTEGER PRIMARY KEY AUTOINCREMENT, choice TEXT, time STRING)"
        );
      } else {
        // We have a database already - write Choices records to log for info
        await db.all("SELECT * from Choices");

        //If you need to remove a table from the database use this syntax
        //db.run("DROP TABLE Logs"); //will fail if the table doesn't exist
      }
    } catch (dbError) {
      console.error(dbError);
    }
  });

// Require the fastify framework and instantiate it
const fastify = require("fastify")({
  // Set this to true for detailed logging:
  logger: false
});

// Setup our static files
fastify.register(require("fastify-static"), {
  root: path.join(__dirname, "public"),
  prefix: "/" // optional: default '/'
});

// fastify-formbody lets us parse incoming forms
fastify.register(require("fastify-formbody"));

// point-of-view is a templating manager for fastify
fastify.register(require("point-of-view"), {
  engine: {
    handlebars: require("handlebars")
  }
});

// Load and parse SEO data
const seo = require("./src/seo.json");
if (seo.url === "glitch-default") {
  seo.url = `https://${process.env.PROJECT_DOMAIN}.glitch.me`;
}

// Home route for the app
fastify.get("/", async (request, reply) => {
  // Params is the data we pass to the handlebars templates
  let params = { seo: seo };
  // Get the available choices from the database
  let languages;
  // We use a try catch block in case of db errors
  try {
    languages = await db.all("SELECT * from Choices");
    // Pass the rows into the page params
    params.options = languages;
  } catch (dbError) {
    console.error(dbError);
    // Let the user know there was a db error
    params.error = true;
  }
  // The page builds the choices into the poll form
  reply.view("/src/pages/index.hbs", params);
});

// Route to process user poll pick
fastify.post("/pick", async (request, reply) => {
  let params = { seo: seo };
  // We have a language pick
  if (request.body.language) {
    // Flag to indicate a choice was picked - will show the poll results instead of the poll form
    params.picked = true;
    // Insert new Log table entry indicating the user choice and timestamp
    try {
      // Build the user data from the front-end and the current time into the sql query
      await db.run(
        "INSERT INTO Log (choice, time) VALUES (?, ?)", [
        request.body.language, new Date().toISOString()
      ]
    );
      // Update the number of times the choice has been picked by adding one to it
      await db.run(
        "UPDATE Choices SET picks = picks + 1 WHERE language = ?",
          request.body.language
      );
      // Return the choices so far - page will build these into a chart
      let picked = await db.all("SELECT * from Choices");
      // We send the choices and numbers in parallel arrays
      params.choices = JSON.stringify(picked.map(c => c.language));
      params.picks = JSON.stringify(picked.map(c => c.picks));
    } catch (dbError) {
      console.error(dbError);
      params.error = true;
    }
    // Return the info to the page
    reply.view("/src/pages/index.hbs", params);
  }
});

// Admin endpoint to get logs
fastify.get("/logs", async (request, reply) => {
  let params = {};
  // Return most recent 20
  //let log;
  try {
    // Return the array of log entries to admin page
    params.logs = await db.all("SELECT * from Log ORDER BY time DESC LIMIT 20");
  } catch (dbError) {
    console.error(dbError);
    params.error = true;
  }
  reply.view("/src/pages/admin.hbs", params);
});

// Admin endpoint to empty all logs - requires auth (instructions in README)
fastify.post("/clearLogs", async (request, reply) => {
  let params = {};
  // Authenticate the user request by checking against the env key variable
  if (
    !request.body.key ||
    request.body.key.length < 1 ||
    request.body.key !== process.env.ADMIN_KEY
  ) {
    // Auth failed, return the log data plus a failed flag
    params.failed = true;
    // Send the log list
    try {
      params.logs = await db.all("SELECT * from Log ORDER BY time DESC LIMIT 20");
    } catch (dbError) {
      console.error(dbError);
      params.error = true;
    }
    reply.view("/src/pages/admin.hbs", params);
  } else {
    // We have a valid key and can clear the log
    try {
      await db.run("DELETE from Log");
      // Log cleared, return an empty array to admin page
      params.logs = [];
    } catch (dbError) {
      console.error(dbError);
      params.error = true;
    }
    reply.view("/src/pages/admin.hbs", params);
  }
});

// Run the server and report out to the logs
fastify.listen(process.env.PORT, function(err, address) {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  console.log(`Your app is listening on ${address}`);
  fastify.log.info(`server listening on ${address}`);
});
