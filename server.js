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
const db = new sqlite3.Database(dbFile);

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

// If db does not exist, create tables, otherwise print records to console
db.serialize(() => {
  if (!exists) {
    // Database doesn't exist yet - create Choices and Log tables
    db.run(
      "CREATE TABLE Choices (id INTEGER PRIMARY KEY AUTOINCREMENT, language TEXT, picks INTEGER)"
    );
    // Add default choices to table
    db.run(
      "INSERT INTO Choices (language, picks) VALUES ('HTML', 0), ('JavaScript', 0), ('CSS', 0)"
    );
    // Log can start empty - we'll insert a new record whenever the user chooses a poll option
    db.run(
      "CREATE TABLE Log (id INTEGER PRIMARY KEY AUTOINCREMENT, choice TEXT, time STRING)"
    );
  } else {
    // We have a database already - write Choices records to log for info
    db.each("SELECT * from Choices", (err, row) => {
      if (row) { console.log(`record: ${row.language}`); }
    });
    
    //If you need to remove a table from the database use this syntax
    //db.run("DROP TABLE Choices"); //will fail if the table doesn't exist
  }
});

// Home route for the app
fastify.get("/", (request, reply) => {
  // Params is the data we pass to the handlebars templates
  let params = { seo: seo };
  // Get the available choices from the database
  db.all("SELECT * from Choices", (err, rows) => {
    if (!err) {
      // Pass the db rows to the page
      params.options = rows;
      // The page builds the choices into the poll form
      reply.view("/src/pages/index.hbs", params);
    } else console.log(err);
  });
});

// Route to process user poll pick
fastify.post("/", (request, reply) => {
  let params = { seo: seo };
  // We don't have a language pick
  if(!request.body.language){
    db.all("SELECT * from Choices", (err, rows) => {
      if (!err) {
        // Pass the db rows to the page
        params.options = rows;
        // The page builds the choices into the poll form
        reply.view("/src/pages/index.hbs", params);
      } else console.log(err);
    });
  }
  // Flag to indicate a choice was picked - will show the poll results instead of the poll form
  params.picked = true;
  // Update the database
  db.serialize(() => {
    // Insert new Log table entry indicating the user choice and timestamp
    db.run(
      "INSERT INTO Log (choice, time) VALUES ('" +
        request.body.language +
        "', '" +
        new Date().toLocaleString() +
        "')"
    );
    // Update the number of times the choice has been picked
    db.all(
      "UPDATE Choices SET picks = picks + 1 WHERE language = '" +
        request.body.language +
        "'",
      err => {
        if (!err) {
          // Return the choices so far - page will build these into a chart
          db.all("SELECT * from Choices", (err, rows) => {
            // We send the choices and numbers in parallel arrays
            params.choices = JSON.stringify(rows.map(c => c.language));
            params.picks = JSON.stringify(rows.map(p => p.picks));
            reply.view("/src/pages/index.hbs", params);
          });
        }
      }
    );
  });
});

// Admin endpoint to get logs
fastify.get("/logs", (request, reply) => {
  let params = {};
  // Return most recent 20
  db.all("SELECT * from Log ORDER BY time DESC LIMIT 20", (err, rows) => {
    // Return the array of log entries to admin page
    params.logs = rows;
    reply.view("/src/pages/admin.hbs", params);
  });
});

// Admin endpoint to empty all logs - requires auth (instructions in README)
fastify.post("/clearLogs", (request, reply) => {
  let params = {};
  // Authenticate the user request by checking against the env key variable
  if (!request.body.key || request.body.key.length<1 || request.body.key !== process.env.ADMIN_KEY) {
    // Auth failed, return the log data plus a failed flag
    let params = {};
    params.failed = true;
    // Send the log list 
    db.all("SELECT * from Log ORDER BY time DESC LIMIT 20", (err, rows) => {
      params.logs = rows;
      reply.view("/src/pages/admin.hbs", params);
    });
  } else {
    // We have a valid key and can clear the log
    db.each(
      "SELECT * from Log",
      (err, row) => {
        db.run(`DELETE FROM Log WHERE ID=?`, row.id, error => {
          if (row) {
            console.log(`deleted row ${row.id}`);
          }
        });
      },
      err => {
        if (err) {
          // Something went wrong - you could replace this with an error hbs template
          reply.send({ message: "error!" });
        } else {
          // Log cleared, return an empty array to admin page
          params.logs=[];
          reply.view("/src/pages/admin.hbs", params);
        }
      }
    );
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
