import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mysql from "mysql2/promise";
import { createRemoteJWKSet, jwtVerify } from "jose-cjs";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

dotenv.config();
const app = express();

// 💡 ফিক্স ১: পোর্ট ব্যাকআপ রাখা (যদি .env থেকে PORT না পায়, তবে ডিফল্ট 3002 নিবে)
const PORT = process.env.PORT || 3002;

let db = null;

app.use(helmet());
app.use(express.json());

app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
  })
);

async function connectDB() {
  try {
    db = mysql.createPool({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });

    await db.query("SELECT 1");
    console.log("XAMPP MySQL Database Connected Successfully!");
  } catch (error) {
    console.error("Database connection failed:", error.message);
    process.exit(1);
  }
}

connectDB();

// ========================
// VERIFY TOKEN
// ========================
const verifyToken = async (req, res, next) => {
  const { authorization } = req.headers;
  const token = authorization?.split(" ")[1];
  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  try {
    const JWKS = createRemoteJWKSet(
      new URL(`${process.env.CLIENT_URL}/api/auth/jwks`),
    );
    const { payload } = await jwtVerify(token, JWKS);
    req.user = payload;
    next();
  } catch (error) {
    console.error("Token validation failed:", error);
    return res.status(401).json({ message: "Unauthorized" });
  }
};

// GET Method
app.get("/", (req, res) => {
  res.send("Hello World! Pure JavaScript Backend Running smoothly.");
});
const handleGetRequest = (sqlQuery, getParamsFn) => {
  return async (req, res, next) => {
    try {
      const params = getParamsFn ? getParamsFn(req) : [];
      
      const [rows] = await db.query(sqlQuery, params);

      return res.status(200).json({
        success: true,
        count: rows.length,
        data: rows
      });
    } catch (error) {
       console.error("Database Error in handleGetRequest:", error);
      next(error);
    }
  };
};

app.get("/departments", handleGetRequest("SELECT * FROM `Department` ORDER BY `deptId` ASC"));
app.get("/courses", handleGetRequest(`SELECT * FROM \`Course\` c WHERE c.isDeleted = 0 ORDER BY c.courseCode ASC`));
app.get("/users", handleGetRequest("SELECT * FROM `user` u WHERE u.isDeleted = 0 ORDER BY u.id ASC"));
app.get("/students", handleGetRequest("SELECT * FROM `Student` s ORDER BY s.studentId ASC"));
app.get("/sessions", handleGetRequest(`SELECT * FROM \`Session\``));
app.get("/sections", handleGetRequest(`SELECT * FROM \`Section\``));
app.get("/teachers", handleGetRequest(`SELECT * FROM \`Teacher\``));
app.get("/teaches", handleGetRequest(`SELECT * FROM \`Teaches\``));
app.get("/sections/:session", handleGetRequest(`SELECT * FROM \`Section\` WHERE session = ?`,(req) => [req.params.session]));
app.get("/prerequisites/:courseCode", handleGetRequest(`SELECT preCourseCode FROM \`Prerequisites\` WHERE courseCode = ?`,(req) => [req.params.courseCode]));
app.get("/users/:id", handleGetRequest(`SELECT id, name, email, role, status, image, createdAt FROM \`user\` WHERE id = ? AND isDeleted = 0`, (req) => [req.params.id]));
app.get("/teaches/search",handleGetRequest(`SELECT t.teacherId,t.deptId,te.courseCode,c.title,
        c.type,c.credits,te.section,te.session,s.runningYear,s.runningSemester,te.status,te.createdAt,
        te.updatedAt
      FROM Teacher t
      INNER JOIN Teaches te ON t.teacherId = te.teacherId
      INNER JOIN Course c   ON te.courseCode = c.courseCode
      INNER JOIN Session s  ON te.session = s.session
      WHERE t.userId = ?`,(req) => [req.query.userId]));
app.get("/teaches/search",handleGetRequest(`SELECT t.teacherId,t.deptId,te.courseCode,c.title,
        c.type,c.credits,te.section,te.session,s.runningYear,s.runningSemester,te.status,te.createdAt,
        te.updatedAt
      FROM Teacher t
      INNER JOIN Teaches te ON t.teacherId = te.teacherId
      INNER JOIN Course c   ON te.courseCode = c.courseCode
      INNER JOIN Session s  ON te.session = s.session
      WHERE t.userId = ? AND te.courseCode=?`,(req)=>[req.query.userId,req.query.courseCode]));
app.get("/student-courses/:userId", async (req, res, next) => {
  const { userId } = req.params;
  try {
    const [rows] = await db.query(
      `SELECT 
        te.courseCode,
        c.title,
        c.type,
        c.credits,
        te.section,
        te.session,
        te.status,
        s.runningYear,
        s.runningSemester,
        t.name AS teacherName
      FROM Student st
      INNER JOIN Teaches te   ON te.section = st.section AND te.session = st.session
      INNER JOIN Course c     ON te.courseCode = c.courseCode
      INNER JOIN Session s    ON te.session = s.session
      INNER JOIN Teacher t    ON te.teacherId = t.teacherId
      WHERE st.userId = ?`,
      [userId]
    );
    res.status(200).json({ success: true, count: rows.length, data: rows });
  } catch (error) {
    next(error);
  }
});

// POST Method
app.post("/assign-teacher-section", async (req, res, next) => {
  let connection;
  try {
    const { teacherId, courseCode, section, session } = req.body;

    if (!teacherId || !courseCode || !section || !session) {
      return res.status(400).json({ success: false, message: "All fields are required!" });
    }

    connection = await db.getConnection(); 
    await connection.beginTransaction();

     const [sectionExists] = await connection.query(
      "SELECT * FROM `Section` WHERE `section` = ? AND `session` = ?",
      [section, session]
    );

    if (sectionExists.length === 0) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: "This Section and Session combination does not exist!" });
    }

   
    const teachesSql = `INSERT INTO \`Teaches\` (teacherId, courseCode, section, session) VALUES (?, ?, ?, ?)`;
    await connection.query(teachesSql, [teacherId, courseCode, section, session]);

    await connection.commit();
    res.status(201).json({ 
      success: true, 
      message: `Teacher successfully assigned to Section '${section}' for course ${courseCode}!` 
    });

  } catch (error) {
    if (connection) await connection.rollback();
    
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ success: false, message: "This teacher is already assigned to this specific course section and session!" });
    }
     if (error.code === 'ER_NO_REFERENCED_ROW_2') {
      return res.status(400).json({ success: false, message: "Invalid Teacher ID, Course Code, or Session. Please check if they exist." });
    }
    next(error);
  } finally {
    if (connection) connection.release(); 
  }
});

// POST user
app.post("/users", async (req, res) => {
  console.log('req.body: ',req.body);
  const { userId, role, name, deptId, studentId, teacherId, section, session } = req.body;

 if (!userId || !role || !deptId || !name) {
    return res.status(400).json({ success: false, message: "Missing required fields" });
  }

  try {
    if (role && role.toLowerCase() === "student"){
      if (!studentId || !session || !section) {
        return res.status(400).json({ 
          success: false, 
          message: "Student ID, Session, and Section are required for students" 
        });
      }

      const studentSql = `INSERT INTO Student (studentId, userId, deptId, name, section, session) VALUES (?, ?, ?, ?, ?, ?)`;
      await db.query(studentSql, [studentId, userId, deptId, name, section, session]);

    } else if (role && role.toLowerCase() === "teacher") {
      if (!teacherId) {
        return res.status(400).json({ success: false, message: "Teacher ID is required for teachers" });
      }
      const teacherSql = `INSERT INTO Teacher (teacherId, userId, deptId, name) VALUES (?, ?, ?, ?)`;
      await db.query(teacherSql, [teacherId, userId, deptId, name]);
    }

    return res.status(201).json({
      success: true,
      message: `${role === "student" ? "Student" : "Teacher"} profile created successfully!`
    });
  } catch (error) {
    console.error("Database Error:", error);
    return res.status(500).json({ success: false, message: "Database Error: " + error.message });
  }
});


// POST teaches
app.post("/teaches", async (req, res, next) => {
  try {
    const { teacherId, courseCode, section, session } = req.body;
    if (!teacherId || !courseCode || !section || !session) {
      return res.status(400).json({ success: false, message: "All fields are required" });
    }
    const [sectionExists] = await db.query(
      `SELECT * FROM \`Section\` WHERE courseCode = ? AND section = ? AND session = ?`,
      [courseCode, section, session]
    );
    if (sectionExists.length === 0) {
      return res.status(400).json({ success: false, message: "The specified section does not exist. Create the section first!" });
    }
    const sql = `INSERT INTO \`Teaches\` (teacherId, courseCode, section, session) VALUES (?, ?, ?, ?)`;
    await db.query(sql, [teacherId, courseCode, section, session]);
    res.status(201).json({ success: true, message: "Teacher assigned to section successfully!" });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ success: false, message: "This teacher is already assigned to this section!" });
    }
    next(error);
  }
});


app.use((err, req, res, next) => {
  console.error("Global Error Log:", err.stack);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal Server Error"
  });
});

app.listen(PORT, () => {
  console.log(`Server successfully listening on port ${PORT}`);
});