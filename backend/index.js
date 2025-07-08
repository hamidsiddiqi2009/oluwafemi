require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { PDFDocument, rgb } = require('pdf-lib');
const axios = require('axios');
const chatRouter = require('./chat');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3001;

// Trust proxy configuration
app.set('trust proxy', 1);

// Middleware
app.use(helmet());
app.use(cors({
  origin: ['https://*.teachable.com', 'http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:5173'],
  credentials: true
}));
app.use(express.json());

// Rate limiting - increased for better user experience
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // 100 requests per window
});

// Teachable API configuration
const TEACHABLE_API_KEY = process.env.TEACHABLE_API_KEY;
const teachableApi = axios.create({
  baseURL: 'https://developers.teachable.com/v1',
  headers: {
    'apiKey': TEACHABLE_API_KEY,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  }
});

// Add request interceptor for better error logging
teachableApi.interceptors.request.use(request => {
  return request;
});

teachableApi.interceptors.response.use(
  response => response,
  error => {
    return Promise.reject(error);
  }
);

// Helper function to check if activities are within the same session window (30 minutes)
const isWithinSessionWindow = (timestamp1, timestamp2) => {
  const timeDiff = Math.abs(new Date(timestamp1) - new Date(timestamp2));
  return timeDiff <= 30 * 60 * 1000; // 30 minutes in milliseconds
};

// Helper function to calculate session duration
const calculateSessionDuration = (start, end) => {
  return Math.round((new Date(end) - new Date(start)) / (1000 * 60));
};

// Helper function to get lecture progress
async function getLectureProgress(userId, courseId, enrollmentId) {
  try {
    const response = await teachableApi.get(`/courses/${courseId}/enrollments/${enrollmentId}/lectures`);
    return response.data.lectures || [];
  } catch (error) {
    return [];
  }
}

// Helper function to get submissions
async function getSubmissions(userId, courseId) {
  try {
    const response = await teachableApi.get(`/courses/${courseId}/students/${userId}/submissions`);
    return response.data.submissions || [];
  } catch (error) {
    return [];
  }
}

// Helper function to calculate sessions from activities
function calculateSessionTime(activities) {
  if (!activities.length) return [];
  
  // Sort activities by timestamp
  activities.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  
  let sessions = [];
  let currentSession = null;
  
  activities.forEach(activity => {
    if (!currentSession) {
      currentSession = {
        start: activity.timestamp,
        end: activity.timestamp,
        activities: [activity],
        course_name: activity.course
      };
    } else if (isWithinSessionWindow(activity.timestamp, currentSession.end)) {
      // Extend current session
      currentSession.end = activity.timestamp;
      currentSession.activities.push(activity);
    } else {
      // Start new session
      sessions.push({
        start: currentSession.start,
        end: currentSession.end,
        duration: calculateSessionDuration(currentSession.start, currentSession.end),
        course_name: currentSession.course_name,
        activity_count: currentSession.activities.length
      });
      
      currentSession = {
        start: activity.timestamp,
        end: activity.timestamp,
        activities: [activity],
        course_name: activity.course
      };
    }
  });
  
  // Add the last session
  if (currentSession) {
    sessions.push({
      start: currentSession.start,
      end: currentSession.end,
      duration: calculateSessionDuration(currentSession.start, currentSession.end),
      course_name: currentSession.course_name,
      activity_count: currentSession.activities.length
    });
  }
  
  return sessions;
}

// Updated getUserSessions function
async function getUserSessions(userId) {
  try {
    // First get all courses
    const coursesResponse = await teachableApi.get('/courses');
    
    const courses = coursesResponse.data.courses || [];

    const allActivities = [];
    
    // For each course, get the user's activities
    for (const course of courses) {
      try {
        // First check if user is enrolled in this course
        const enrollmentResponse = await teachableApi.get(`/courses/${course.id}/enrollments`, {
          params: { user_id: userId }
        });
        
        if (enrollmentResponse.data && enrollmentResponse.data.enrollments && enrollmentResponse.data.enrollments.length > 0) {
          const enrollment = enrollmentResponse.data.enrollments[0];
          
          // Get lecture progress
          const lectureProgress = await getLectureProgress(userId, course.id, enrollment.id);
          lectureProgress.forEach(lecture => {
            if (lecture.started_at) {
              allActivities.push({
                type: 'lecture',
                timestamp: lecture.started_at,
                course: course.name,
                lecture_name: lecture.title
              });
            }
            if (lecture.completed_at) {
              allActivities.push({
                type: 'lecture_complete',
                timestamp: lecture.completed_at,
                course: course.name,
                lecture_name: lecture.title
              });
            }
          });
          
          // Get submissions
          const submissions = await getSubmissions(userId, course.id);
          submissions.forEach(submission => {
            allActivities.push({
              type: 'submission',
              timestamp: submission.submitted_at,
              course: course.name,
              submission_type: submission.type
            });
          });
        }
      } catch (error) {
        continue;
      }
    }

    // Calculate sessions from all activities
    const sessions = calculateSessionTime(allActivities);
    
    // Sort sessions by start time
    return sessions.sort((a, b) => new Date(a.start) - new Date(b.start));
  } catch (error) {
    return [];
  }
}

// API Endpoints
app.get('/api/sessions', limiter, async (req, res) => {
  try {
    const { email } = req.query;
    
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    // Fetch user data from Teachable
    const userResponse = await teachableApi.get('/users', {
      params: { 
        email: email,
        per_page: 1
      }
    });
    
    if (!userResponse.data || !userResponse.data.users || userResponse.data.users.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userId = userResponse.data.users[0].id;

    const sessions = await getUserSessions(userId);
    
    const totalMinutes = sessions.reduce((sum, session) => sum + session.duration, 0);
    
    const response = {
      sessions,
      total: totalMinutes,
      user: {
        email: userResponse.data.users[0].email,
        name: userResponse.data.users[0].name
      }
    };
    
    res.json(response);
  } catch (error) {
    if (error.response?.status === 404) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    if (error.response?.status === 401) {
      return res.status(401).json({ message: 'Invalid API key' });
    }
    
    res.status(500).json({ 
      message: 'Failed to fetch session data',
      details: error.response?.data || error.message
    });
  }
});

app.post('/api/generate-pdf', limiter, async (req, res) => {
  try {
    const { email, sessions, totalTime } = req.body;
    
    if (!email || !sessions || totalTime === undefined) {
      return res.status(400).json({ message: 'Missing required data' });
    }

    // Create PDF
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage();
    const { width, height } = page.getSize();
    
    // Add content with better formatting
    page.drawText(`My Time Report`, {
      x: 50,
      y: height - 50,
      size: 24,
      color: rgb(0.04, 0.65, 0.6) // Teachable green color
    });

    page.drawText(`Email: ${email}`, {
      x: 50,
      y: height - 80,
      size: 12
    });

    let yOffset = height - 120;
    
    // Add total time
    page.drawText(`Total Connection Time: ${Math.floor(totalTime / 60)}h ${totalTime % 60}m`, {
      x: 50,
      y: yOffset,
      size: 14,
      color: rgb(0.04, 0.65, 0.6)
    });
    yOffset -= 40;

    // Add session details
    page.drawText('Session Details:', {
      x: 50,
      y: yOffset,
      size: 16,
      color: rgb(0.04, 0.65, 0.6)
    });
    yOffset -= 30;

    sessions.forEach((session, index) => {
      if (yOffset < 50) {
        // Add new page if we're running out of space
        const newPage = pdfDoc.addPage();
        yOffset = newPage.getSize().height - 50;
      }

      page.drawText(`Session ${index + 1}:`, {
        x: 50,
        y: yOffset,
        size: 12
      });
      yOffset -= 20;
      
      page.drawText(`Start: ${new Date(session.start).toLocaleString()}`, {
        x: 70,
        y: yOffset,
        size: 10
      });
      yOffset -= 15;
      
      page.drawText(`End: ${new Date(session.end).toLocaleString()}`, {
        x: 70,
        y: yOffset,
        size: 10
      });
      yOffset -= 15;
      
      page.drawText(`Duration: ${Math.floor(session.duration / 60)}h ${session.duration % 60}m`, {
        x: 70,
        y: yOffset,
        size: 10
      });
      yOffset -= 30;
    });

    const pdfBytes = await pdfDoc.save();
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=my-time-report-${email}.pdf`);
    res.send(Buffer.from(pdfBytes));
  } catch (error) {
    res.status(500).json({ message: 'Failed to generate PDF report' });
  }
});

// Proxy endpoint: Get user by email
app.get('/api/teachable/users', limiter, async (req, res) => {
  try {
    const { email, per } = req.query;
    const response = await teachableApi.get('/users', {
      params: { email, per }
    });
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({ message: error.message, details: error.response?.data });
  }
});

// Proxy endpoint: Get user details by ID
app.get('/api/teachable/users/:id', limiter, async (req, res) => {
  try {
    const { id } = req.params;
    const response = await teachableApi.get(`/users/${id}`);
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({ message: error.message, details: error.response?.data });
  }
});

// Proxy endpoint: Get course progress for a user
app.get('/api/teachable/courses/:courseId/progress', limiter, async (req, res) => {
  try {
    const { courseId } = req.params;
    const { user_id } = req.query;
    const response = await teachableApi.get(`/courses/${courseId}/progress`, {
      params: { user_id }
    });
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({ message: error.message, details: error.response?.data });
  }
});

app.post('/api/teachable/generate-progress-pdf', limiter, async (req, res) => {
  try {
    const { user, courses, progress, activities, totalDurationMs } = req.body;
    const pdfDoc = await PDFDocument.create();
    let page = pdfDoc.addPage();
    const { width, height } = page.getSize();

    let y = height - 40;
    page.drawText(`Student: ${user.name} (${user.email})`, { x: 40, y, size: 14 });
    y -= 24;

    // Total time
    const totalMinutes = Math.floor((totalDurationMs || 0) / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    page.drawText(`Total Connection Time: ${hours}h ${minutes}m`, { x: 40, y, size: 12 });
    y -= 24;

    // Activities Table Header
    page.drawText('Login/Logout Activity:', { x: 40, y, size: 12 });
    y -= 18;
    page.drawText('Event', { x: 40, y, size: 10 });
    page.drawText('Timestamp', { x: 120, y, size: 10 });
    y -= 14;

    // Activities Table Rows
    (activities || []).forEach(act => {
      if (y < 40) {
        page = pdfDoc.addPage();
        y = height - 40;
      }
      page.drawText(act.event, { x: 40, y, size: 10 });
      page.drawText(new Date(act.timestamp).toLocaleString(), { x: 120, y, size: 10 });
      y -= 14;
    });

    // --- Course Overview Section ---
    if (y < 100) {
      page = pdfDoc.addPage();
      y = height - 40;
    }
    page.drawText('Course Overview:', { x: 40, y, size: 12 });
    y -= 18;

    (courses || []).forEach(course => {
      if (y < 60) {
        page = pdfDoc.addPage();
        y = height - 40;
      }
      page.drawText(`Course: ${course.course_name}`, { x: 40, y, size: 11 });
      y -= 14;
      page.drawText(`Progress: ${course.percent_complete ?? 0}%`, { x: 60, y, size: 10 });
      y -= 12;
      page.drawText(`Enrolled: ${course.enrolled_at ? new Date(course.enrolled_at).toLocaleString() : '-'}`, { x: 60, y, size: 10 });
      y -= 12;
      page.drawText(`Completed: ${course.completed_at ? new Date(course.completed_at).toLocaleString() : 'In Progress'}`, { x: 60, y, size: 10 });
      y -= 18;

      // Optionally, add lecture details if you want
      if (progress && progress[course.course_id] && progress[course.course_id].lecture_sections) {
        progress[course.course_id].lecture_sections.forEach(section => {
          if (y < 60) {
            page = pdfDoc.addPage();
            y = height - 40;
          }
          page.drawText(`Section: ${section.name}`, { x: 80, y, size: 10 });
          y -= 12;
          section.lectures.forEach(lecture => {
            if (y < 50) {
              page = pdfDoc.addPage();
              y = height - 40;
            }
            page.drawText(
              `- ${lecture.name}: ${lecture.is_completed ? 'Completed' : 'Not Started'}${lecture.completed_at ? ` (${new Date(lecture.completed_at).toLocaleString()})` : ''}`,
              { x: 100, y, size: 9 }
            );
            y -= 10;
          });
        });
      }
      y -= 6;
    });

    const pdfBytes = await pdfDoc.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=course-progress-${user.email}.pdf`);
    res.send(Buffer.from(pdfBytes));
  } catch (error) {
    res.status(500).json({ message: 'Failed to generate PDF report' });
  }
});

const SETTINGS_PATH = path.join(__dirname, 'settings.json');

function loadSettings() {
  if (!fs.existsSync(SETTINGS_PATH)) {
    // Default settings
    return {
      systemPromptInstructor: 'You are Instructor Alex, an AI instructor. Reply to the student in under 50 words.',
      systemPromptClassmate: 'You are a classmate in an online class. Reply to the student in under 30 words.'
    };
  }
  return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
}

function saveSettings(settings) {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

app.get('/api/admin/settings', (req, res) => {
  res.json(loadSettings());
});

app.post('/api/admin/settings', (req, res) => {
  const settings = req.body;
  saveSettings(settings);
  res.json({ success: true });
});

app.use('/api', chatRouter);

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

module.exports.loadSettings = loadSettings;
module.exports.saveSettings = saveSettings;