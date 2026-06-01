// app.js
// CodeCraftHub - A simple REST API to manage learning courses
// Features implemented:
// - CRUD operations for courses
// - JSON file storage (courses.json) with auto-creation
// - Validation for required fields, date format, and allowed status
// - Error handling for missing fields, not found, invalid status, and file I/O errors
// - Server runs on port 5000

const express = require("express");
const fs = require("fs").promises;
const path = require("path");

const app = express();
const PORT = 5000;

// Path to the JSON storage file
const DATA_FILE = path.join(__dirname, "courses.json");

// Middleware to parse JSON bodies
app.use(express.json());

// Ensure the data file exists on startup
async function ensureDataFile() {
  try {
    // Try to access the file
    await fs.access(DATA_FILE);
  } catch (err) {
    if (err.code === "ENOENT") {
      // If it doesn't exist, create it with an empty array
      await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
      await fs.writeFile(DATA_FILE, JSON.stringify([], null, 2), "utf8");
      console.log(`Created data file at ${DATA_FILE}`);
    } else {
      // Other I/O errors
      throw err;
    }
  }
}

// Helper to compute statistics for courses by status
function computeCourseStats(courses) {
  const byStatus = {
    "Not Started": 0,
    "In Progress": 0,
    Completed: 0,
  };

  if (!Array.isArray(courses)) return { total: 0, byStatus };

  for (const c of courses) {
    if (byStatus.hasOwnProperty(c.status)) {
      byStatus[c.status] += 1;
    }
  }

  return {
    total: courses.length,
    byStatus,
  };
}

// Load all courses from the JSON file
async function loadCourses() {
  try {
    const text = await fs.readFile(DATA_FILE, "utf8");
    const data = JSON.parse(text);
    // Normalize to an array
    if (Array.isArray(data)) return data;
    return [];
  } catch (err) {
    // If the file somehow disappeared between operations
    if (err.code === "ENOENT") {
      await ensureDataFile();
      return [];
    }
    throw err;
  }
}

// Save the entire courses array back to the JSON file
async function saveCourses(courses) {
  await fs.writeFile(DATA_FILE, JSON.stringify(courses, null, 2), "utf8");
}

// Validate course payload for required fields, types, and formats
function validateCoursePayload(payload, requireAll = true) {
  const errors = [];

  // Required fields (used for create; for updates you can call with requireAll = true too)
  const requiredFields = ["name", "description", "target_date", "status"];
  if (requireAll) {
    requiredFields.forEach((field) => {
      if (payload[field] === undefined || payload[field] === null || payload[field] === "") {
        errors.push(`${field} is required`);
      }
    });
  }

  // Type checks (best-effort)
  if (payload.name != null && typeof payload.name !== "string") {
    errors.push("name must be a string");
  }
  if (payload.description != null && typeof payload.description !== "string") {
    errors.push("description must be a string");
  }

  // target_date must be in YYYY-MM-DD format and a valid date
  if (payload.target_date != null) {
    const t = payload.target_date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || isNaN(Date.parse(t))) {
      errors.push("target_date must be in format YYYY-MM-DD and a valid date");
    }
  }

  // status must be one of the allowed values
  if (payload.status != null) {
    const allowed = ["Not Started", "In Progress", "Completed"];
    if (!allowed.includes(payload.status)) {
      errors.push(`status must be one of ${allowed.join(", ")}`);
    }
  }

  return errors;
}

// Compute the next auto-generated id
function getNextId(courses) {
  if (!Array.isArray(courses) || courses.length === 0) return 1;
  const max = Math.max(...courses.map((c) => (typeof c.id === "number" ? c.id : 0)));
  return max + 1;
}

// Initialize data file before handling requests
ensureDataFile().catch((err) => {
  console.error("Failed to prepare data file:", err);
  process.exit(1);
});

// Routes

app.get('/', (req, res) => {
    // __dirname points to the directory containing this file
    res.sendFile(path.join(__dirname, 'index.html'));
});


// POST /api/courses
// Add a new course
app.post("/api/courses", async (req, res) => {
  try {
    const payload = req.body;

    // Validate required fields
    const errors = validateCoursePayload(payload, true);
    if (errors.length) {
      return res.status(400).json({ errors });
    }

    // Load existing courses, assign new id, and add created_at timestamp
    const courses = await loadCourses();
    const newId = getNextId(courses);
    const createdAt = new Date().toISOString();
    const course = {
      id: newId,
      name: payload.name,
      description: payload.description,
      target_date: payload.target_date,
      status: payload.status,
      created_at: createdAt,
    };

    courses.push(course);
    await saveCourses(courses);

    return res.status(201).json(course);
  } catch (err) {
    console.error("Error creating course:", err);
    return res.status(500).json({ error: "Failed to create course" });
  }
});

// GET /api/courses
// Get all courses
app.get("/api/courses", async (req, res) => {
  try {
    const courses = await loadCourses();
    return res.json(courses);
  } catch (err) {
    console.error("Error loading courses:", err);
    return res.status(500).json({ error: "Failed to load courses" });
  }
});

// GET /api/courses/:id
// Get a specific course by id
app.get("/api/courses/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    return res.status(400).json({ error: "Invalid id" });
  }

  try {
    const courses = await loadCourses();
    const course = courses.find((c) => c.id === id);
    if (!course) {
      return res.status(404).json({ error: "Course not found" });
    }
    return res.json(course);
  } catch (err) {
    console.error("Error fetching course:", err);
    return res.status(500).json({ error: "Failed to load course" });
  }
});

// PUT /api/courses
// Update a course by id supplied in the request body
// Expected body: { id, name, description, target_date, status }
app.put("/api/courses/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid id" });
    }

    const payload = req.body;

    // id is required to update
    if (id === undefined || id === null) {
      return res.status(400).json({ error: "id is required for update" });
    }

    // Validate required fields (full update semantics)
    const requiredFields = ["name", "description", "target_date", "status"];
    const missing = requiredFields.filter((f) => payload[f] === undefined || payload[f] === null || payload[f] === "");
    if (missing.length) {
      return res.status(400).json({ error: `Missing required field(s): ${missing.join(", ")}` });
    }

    // Validate field types/values
    const errors = validateCoursePayload(payload, true);
    if (errors.length) {
      return res.status(400).json({ errors });
    }

    // Load existing courses and apply update
    const courses = await loadCourses();
    const idx = courses.findIndex((c) => c.id === id);
    if (idx === -1) {
      return res.status(404).json({ error: "Course not found" });
    }

    // Preserve original created_at
    const updatedAt = new Date().toISOString();
    const existing = courses[idx];
    const updatedCourse = {
      id,
      name: payload.name,
      description: payload.description,
      target_date: payload.target_date,
      status: payload.status,
      created_at: existing.created_at,
      updated_at: updatedAt, // optional field to indicate update time
    };

    courses[idx] = updatedCourse;
    await saveCourses(courses);

    return res.json(updatedCourse);
  } catch (err) {
    console.error("Error updating course:", err);
    return res.status(500).json({ error: "Failed to update course" });
  }
});

// DELETE /api/courses
// Delete a course by id supplied in the request body
// Expected body: { id }
app.delete("/api/courses/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);

    if (id === undefined || id === null) {
      return res.status(400).json({ error: "id is required to delete a course" });
    }

    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "id must be a number" });
    }

    const courses = await loadCourses();
    const idx = courses.findIndex((c) => c.id === id);
    if (idx === -1) {
      return res.status(404).json({ error: "Course not found" });
    }

    // Remove the course
    courses.splice(idx, 1);
    await saveCourses(courses);

    // 204 No Content on successful deletion
    return res.status(204).end();
  } catch (err) {
    console.error("Error deleting course:", err);
    return res.status(500).json({ error: "Failed to delete course" });
  }
});

// Root route to indicate API is running
app.get("/", (req, res) => {
  res.send("CodeCraftHub API is running on port 5000");
});


// GET /api/courses/stats
// Returns: { total: number, byStatus: { 'Not Started': number, 'In Progress': number, 'Completed': number } }
app.get("/api/courses/stats", async (req, res) => {
  try {
    const courses = await loadCourses();
    const stats = computeCourseStats(courses);
    res.json(stats);
  } catch (err) {
    console.error("Error generating course stats:", err);
    res.status(500).json({ error: "Failed to compute statistics" });
  }
});


// Start the server
app.listen(PORT, () => {
  console.log(`CodeCraftHub server is listening on port ${PORT}`);
});
