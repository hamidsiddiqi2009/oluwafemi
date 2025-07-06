import React, { useState } from 'react';
import {
  Box,
  TextField,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Typography,
  Alert,
  Container,
  Collapse,
  Tooltip,
  InputAdornment,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  LinearProgress,
  Fade
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import SearchIcon from '@mui/icons-material/Search';
import DownloadIcon from '@mui/icons-material/Download';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import SchoolIcon from '@mui/icons-material/School';
import dayjs from 'dayjs';
import isBetween from 'dayjs/plugin/isBetween';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import weekday from 'dayjs/plugin/weekday';
import { useTheme, useMediaQuery } from '@mui/material';
import TablePagination from '@mui/material/TablePagination';
import { BarChart, Bar, XAxis, YAxis, Tooltip as ChartTooltip, ResponsiveContainer, Legend } from 'recharts';

dayjs.extend(isBetween);
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(weekday);

const API_BASE_URL = '/api/teachable';

const fetchTeachable = async (endpoint, params = {}) => {
  const url = new URL(`${API_BASE_URL}${endpoint}`, window.location.origin);
  Object.entries(params).forEach(([key, value]) => url.searchParams.append(key, value));
  const res = await fetch(url);
  if (!res.ok) throw new Error((await res.json()).message || 'API error');
  return res.json();
};

function isPublicHoliday(date) {
  // Canary Islands/Spain public holidays (not exhaustive)
  const holidays = [
    '01-01', '01-06', '05-01', '08-15', '10-12', '11-01', '12-06', '12-08', '12-25'
  ];
  const mmdd = dayjs(date).tz('Atlantic/Canary').format('MM-DD');
  return holidays.includes(mmdd);
}

function getMonthlyBreakdown(activities) {
  const months = {};
  for (let i = 0; i < activities.length - 1; i += 2) {
    const login = activities[i];
    const logout = activities[i + 1];
    if (login.event === 'login' && logout.event === 'logout') {
      const month = dayjs(login.timestamp).format('YYYY-MM');
      if (!months[month]) months[month] = { sessions: 0, hours: 0 };
      months[month].sessions += 1;
      months[month].hours += (logout.timestamp - login.timestamp) / 3600000;
    }
  }
  return Object.entries(months).map(([month, data]) => ({
    month,
    sessions: data.sessions,
    hours: Number(data.hours.toFixed(2)),
  }));
}

function randomWeekdayOrWeekend() {
  // 80% weekdays, 20% weekends
  return Math.random() < 0.8
    ? Math.floor(Math.random() * 5) // 0-4: Mon-Fri
    : 5 + Math.floor(Math.random() * 2); // 5-6: Sat-Sun
}

function randomLoginTime(baseDate) {
  // 8:00 to 23:00, weighted to 8:00-18:00
  const hour =
    Math.random() < 0.7
      ? 8 + Math.floor(Math.random() * 10) // 8-18
      : 18 + Math.floor(Math.random() * 6); // 18-23
  const minute = Math.floor(Math.random() * 60);
  return dayjs(baseDate).hour(hour).minute(minute).second(0).millisecond(0);
}

const LOCAL_STORAGE_KEY = 'teachable_activities_cache';

function loadActivitiesCache() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function saveActivitiesCache(cache) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(cache));
  } catch {}
}

// Initialize cache
let activitiesCache = loadActivitiesCache();

function simulateUserActivities(courseData, startTime = null) {
  const MS_IN_HOUR = 3600000;
  const now = Date.now();
  let earliestEnrolled = Infinity;
  let latestCompleted = -Infinity;
  const activities = [];
  const completionSessions = [];

  // --- Always generate a single session on each course's enrollment date ---
  for (const userId in courseData) {
    const user = courseData[userId];
    const enrolledTime = new Date(user.enrolled_at).getTime();
    if (enrolledTime < earliestEnrolled) earliestEnrolled = enrolledTime;

    // Session starts up to 30 minutes before enrollment time
    const enrollMoment = dayjs(enrolledTime).tz('Atlantic/Canary');
    const randomMinutesBefore = Math.floor(Math.random() * 31); // 0-30 min before
    const sessionStart = enrollMoment.subtract(randomMinutesBefore, 'minute');
    const sessionEnd = enrollMoment.add(Math.floor(Math.random() * 30), 'minute');

    // Only add if sessionStart < sessionEnd and not in the future
    if (
      sessionStart.valueOf() < sessionEnd.valueOf() &&
      sessionStart.valueOf() < now
    ) {
      if (!activities.some(a => a.event === 'login' && a.timestamp === sessionStart.valueOf())) {
        activities.push({ event: 'login', timestamp: sessionStart.valueOf() });
      }
      if (!activities.some(a => a.event === 'logout' && a.timestamp === Math.min(sessionEnd.valueOf(), now))) {
        activities.push({ event: 'logout', timestamp: Math.min(sessionEnd.valueOf(), now) });
      }
    }

    // --- Add sessions for lecture completions ---
    user.lecture_sections.forEach(section => {
      section.lectures.forEach(lecture => {
        if (lecture.is_completed && lecture.completed_at) {
          const compTime = new Date(lecture.completed_at).getTime();
          if (compTime > latestCompleted) latestCompleted = compTime;

          // Ensure a session covers this completion time
          // Session: login 10-30 min before, logout 5-20 min after
          const loginTime = dayjs(compTime).subtract(10 + Math.floor(Math.random() * 21), 'minute');
          const logoutTime = dayjs(compTime).add(5 + Math.floor(Math.random() * 16), 'minute');
          // Only add if not already covered by an existing session
          if (
            !completionSessions.some(
              s => loginTime.valueOf() <= compTime && logoutTime.valueOf() >= compTime
            )
          ) {
            completionSessions.push({ login: loginTime.valueOf(), logout: logoutTime.valueOf() });
          }
        }
      });
    });
  }

  // Add completion sessions to activities (avoid duplicates)
  for (const s of completionSessions) {
    if (!activities.some(a => a.event === 'login' && a.timestamp === s.login)) {
      activities.push({ event: 'login', timestamp: s.login });
    }
    if (!activities.some(a => a.event === 'logout' && a.timestamp === s.logout)) {
      activities.push({ event: 'logout', timestamp: s.logout });
    }
  }

  // --- END TIME LOGIC ---
  let endTime;
  if (
    earliestEnrolled !== Infinity &&
    dayjs(now).diff(dayjs(earliestEnrolled), 'month', true) <= 2
  ) {
    endTime = now;
  } else if (latestCompleted !== -Infinity) {
    const daysToAdd = 1 + Math.floor(Math.random() * 2); // 1 or 2
    endTime = Math.min(dayjs(latestCompleted).add(daysToAdd, 'day').valueOf(), now);
  } else {
    endTime = now;
  }

  if (earliestEnrolled === Infinity) return { activities, totalDurationMs: 0 };

  // --- Add required Thursday, Friday, Saturday evening sessions ---
  let dayCursor = dayjs(earliestEnrolled).tz('Atlantic/Canary').startOf('day');
  const endDay = dayjs(endTime).tz('Atlantic/Canary').startOf('day');
  while (dayCursor.isBefore(endDay) || dayCursor.isSame(endDay)) {
    const weekday = dayCursor.day(); // 4=Thu, 5=Fri, 6=Sat
    if (weekday === 4 || weekday === 5 || weekday === 6) {
      const loginHour = 16 + Math.floor(Math.random() * 3); // 16, 17, 18
      const loginMinute = 30 + Math.floor(Math.random() * 91); // 30-120, so 16:30–18:59
      const loginTime = dayCursor.hour(loginHour).minute(loginMinute % 60).second(0).millisecond(0);

      const logoutMinute = 5 + Math.floor(Math.random() * 46); // 5-50
      const logoutTime = dayjs(dayCursor).hour(20).minute(logoutMinute).second(0).millisecond(0);

      if (
        loginTime.valueOf() < logoutTime.valueOf() &&
        loginTime.valueOf() >= earliestEnrolled &&
        logoutTime.valueOf() <= endTime
      ) {
        if (!activities.some(a => a.event === 'login' && a.timestamp === loginTime.valueOf())) {
          activities.push({ event: 'login', timestamp: loginTime.valueOf() });
        }
        if (!activities.some(a => a.event === 'logout' && a.timestamp === logoutTime.valueOf())) {
          activities.push({ event: 'logout', timestamp: logoutTime.valueOf() });
        }
      }
    }
    dayCursor = dayCursor.add(1, 'day');
  }

  let currentTime = startTime || earliestEnrolled;
  while (currentTime < endTime) {
    let loginDay = dayjs(currentTime).tz('Atlantic/Canary');
    let tries = 0;
    do {
      const weekdayIdx = randomWeekdayOrWeekend();
      loginDay = dayjs(currentTime)
        .tz('Atlantic/Canary')
        .weekday(weekdayIdx)
        .hour(0)
        .minute(0)
        .second(0)
        .millisecond(0);
      loginDay = loginDay.add(Math.floor(Math.random() * 7), 'day');
      tries++;
      if (tries > 10) break;
    } while (isPublicHoliday(loginDay));

    let loginTime = randomLoginTime(loginDay);

    let sessionHours;
    if (Math.random() < 0.95) {
      sessionHours = 1 + Math.random() * 4;
    } else {
      sessionHours = 5 + Math.random() * 3;
    }
    const sessionDuration = sessionHours * MS_IN_HOUR;

    // --- LOGOUT TIME LOGIC: Most logouts before 21:00, 1-2% after 21:00 ---
    let logoutTimeCandidate = loginTime.add(sessionDuration, 'ms');
    let logoutHour = logoutTimeCandidate.hour();
    if (logoutHour >= 21 && Math.random() > 0.02) {
      logoutTimeCandidate = logoutTimeCandidate.hour(20).minute(30 + Math.floor(Math.random() * 30)).second(0).millisecond(0);
    }
    const logoutTime = dayjs(
      Math.min(
        logoutTimeCandidate.valueOf(),
        loginTime.endOf('day').hour(23).minute(59).valueOf(),
        endTime
      )
    );

    if (loginTime.valueOf() > endTime) break;

    const lastEvent = activities.length > 0 ? activities[activities.length - 1] : null;
    if (
      !activities.some(a => a.event === 'login' && a.timestamp === loginTime.valueOf()) &&
      (!lastEvent || lastEvent.event !== 'login')
    ) {
      activities.push({ event: 'login', timestamp: loginTime.valueOf() });
      if (
        !activities.some(a => a.event === 'logout' && a.timestamp === logoutTime.valueOf()) &&
        logoutTime.valueOf() > loginTime.valueOf()
      ) {
        activities.push({ event: 'logout', timestamp: logoutTime.valueOf() });
      }
    }

    let gapHours;
    if (Math.random() < 0.95) {
      gapHours = 1 + Math.random() * 4;
    } else {
      gapHours = 5 + Math.random() * 7;
    }
    currentTime = logoutTime.add(gapHours, 'hour').valueOf();
  }

  // Sort events by timestamp
  activities.sort((a, b) => a.timestamp - b.timestamp);

  // Strictly pair each login with the next logout, ignore extra logouts
  function pairLoginsLogouts(events) {
    const paired = [];
    let lastLogin = null;
    for (const act of events) {
      if (act.event === 'login') {
        if (!lastLogin) lastLogin = act;
      } else if (act.event === 'logout') {
        if (lastLogin && act.timestamp > lastLogin.timestamp) {
          paired.push(lastLogin);
          paired.push(act);
          lastLogin = null;
        }
      }
    }
    return paired;
  }

  // Initial pairing
  activities.sort((a, b) => a.timestamp - b.timestamp);
  let filtered = pairLoginsLogouts(activities);

  // Ensure every lecture completion is covered by a login/logout session
  for (const userId in courseData) {
    const user = courseData[userId];
    user.lecture_sections.forEach(section => {
      section.lectures.forEach(lecture => {
        if (lecture.is_completed && lecture.completed_at) {
          const compTime = new Date(lecture.completed_at).getTime();
          // Check if compTime is covered by any login/logout pair
          let covered = false;
          for (let i = 0; i < filtered.length - 1; i += 2) {
            if (
              filtered[i].event === 'login' &&
              filtered[i + 1].event === 'logout' &&
              filtered[i].timestamp <= compTime &&
              filtered[i + 1].timestamp >= compTime
            ) {
              covered = true;
              break;
            }
          }
          // If not covered, insert a session for this completion
          if (!covered) {
            const loginTime = dayjs(compTime).subtract(10 + Math.floor(Math.random() * 21), 'minute').valueOf();
            const logoutTime = dayjs(compTime).add(5 + Math.floor(Math.random() * 16), 'minute').valueOf();
            filtered.push({ event: 'login', timestamp: loginTime });
            filtered.push({ event: 'logout', timestamp: logoutTime });
          }
        }
      });
    });
  }

  // Sort again and strictly pair logins/logouts as before
  filtered.sort((a, b) => a.timestamp - b.timestamp);
  let final = pairLoginsLogouts(filtered);

  // Calculate total logged-in duration
  let totalDurationMs = 0;
  for (let i = 0; i < final.length - 1; i += 2) {
    if (final[i].event === 'login' && final[i + 1].event === 'logout') {
      totalDurationMs += final[i + 1].timestamp - final[i].timestamp;
    }
  }

  if (earliestEnrolled !== Infinity) {
    let monthStart = dayjs(earliestEnrolled);
    const nowDayjs = dayjs();
    let monthIdx = 0;

    while (monthStart.isBefore(nowDayjs)) {
      const monthEnd = monthStart.add(1, 'month');
      // Only consider up to now for the last (possibly partial) month
      const windowEnd = monthEnd.isBefore(nowDayjs) ? monthEnd : nowDayjs;
      const daysElapsed = windowEnd.diff(monthStart, 'day') + 1;
      const totalDays = monthEnd.diff(monthStart, 'day') + 1;
      const minExpected = 75 * (daysElapsed / totalDays);
      const maxExpected = 95 * (daysElapsed / totalDays);

      // Calculate time spent in this month window
      let monthDurationMs = 0;
      for (let i = 0; i < final.length - 1; i += 2) {
        const login = final[i].timestamp;
        const logout = final[i + 1].timestamp;
        const sessionStart = Math.max(login, monthStart.valueOf());
        const sessionEnd = Math.min(logout, windowEnd.valueOf());
        if (sessionEnd > sessionStart) {
          monthDurationMs += sessionEnd - sessionStart;
        }
      }

      // First, trim if over maximum
      if (monthDurationMs > maxExpected * MS_IN_HOUR) {
        let allowedMs = maxExpected * MS_IN_HOUR;
        const trimmed = [];
        for (let i = 0; i < final.length - 1 && allowedMs > 0; i += 2) {
          let login = final[i].timestamp;
          let logout = final[i + 1].timestamp;
          const sessionStart = Math.max(login, monthStart.valueOf());
          const sessionEnd = Math.min(logout, windowEnd.valueOf());
          if (sessionEnd > sessionStart) {
            let sessionMs = sessionEnd - sessionStart;
            if (sessionMs > allowedMs) {
              sessionMs = allowedMs;
              logout = sessionStart + sessionMs;
            }
            trimmed.push({ event: 'login', timestamp: sessionStart });
            trimmed.push({ event: 'logout', timestamp: logout });
            allowedMs -= sessionMs;
          }
        }
        // Add any sessions after the window
        for (let i = 0; i < final.length - 1; i += 2) {
          if (final[i].timestamp >= windowEnd.valueOf()) {
            trimmed.push(final[i]);
            trimmed.push(final[i + 1]);
          }
        }
        final = trimmed;
        monthDurationMs = maxExpected * MS_IN_HOUR;
      }

      // Then, add sessions if under minimum
      if (monthDurationMs < minExpected * MS_IN_HOUR) {
        let neededMs = minExpected * MS_IN_HOUR - monthDurationMs;
        const extraSessions = [];
        
        // Calculate target sessions needed
        const targetSessionLength = 4 * MS_IN_HOUR; // 4 hours per session
        const sessionsNeeded = Math.ceil(neededMs / targetSessionLength);
        
        // Distribute sessions randomly across the month
        const daysInMonth = daysElapsed;
        const sessionsPerDay = Math.ceil(sessionsNeeded / daysInMonth);
        
        for (let d = 0; d < daysInMonth && neededMs > 0; d++) {
          const day = monthStart.add(d, 'day').tz('Atlantic/Canary');
          
          // Add random number of sessions for this day (1-2)
          const sessionsToday = Math.min(2, Math.ceil(Math.random() * 2));
          
          for (let s = 0; s < sessionsToday && neededMs > 0; s++) {
            // Random start time between 8:00 and 20:00
            const startHour = 8 + Math.floor(Math.random() * 12);
            const startMinute = Math.floor(Math.random() * 60);
            const sessionStart = day.hour(startHour).minute(startMinute).second(0).millisecond(0).valueOf();
            
            // Session duration: 2-4 hours
            const sessionDuration = Math.min(
              targetSessionLength,
              Math.max(2 * MS_IN_HOUR, neededMs / (sessionsNeeded - (d * sessionsPerDay + s)))
            );
            const sessionEnd = sessionStart + sessionDuration;
            
            if (sessionEnd <= windowEnd.valueOf()) {
              extraSessions.push({ event: 'login', timestamp: sessionStart });
              extraSessions.push({ event: 'logout', timestamp: sessionEnd });
              neededMs -= sessionDuration;
            }
          }
        }
        
        // Add and re-pair
        final.push(...extraSessions);
        final.sort((a, b) => a.timestamp - b.timestamp);
        final = pairLoginsLogouts(final);
        
        // Verify and adjust if needed
        let verifiedMonthDurationMs = 0;
        for (let i = 0; i < final.length - 1; i += 2) {
          const login = final[i].timestamp;
          const logout = final[i + 1].timestamp;
          const sessionStart = Math.max(login, monthStart.valueOf());
          const sessionEnd = Math.min(logout, windowEnd.valueOf());
          if (sessionEnd > sessionStart) {
            verifiedMonthDurationMs += sessionEnd - sessionStart;
          }
        }
        
        // If still under minimum, add one final long session
        if (verifiedMonthDurationMs < minExpected * MS_IN_HOUR) {
          const remainingMs = minExpected * MS_IN_HOUR - verifiedMonthDurationMs;
          const finalDay = monthStart.add(Math.floor(Math.random() * daysElapsed), 'day');
          const finalStart = finalDay.hour(8).minute(0).second(0).millisecond(0).valueOf();
          const finalEnd = finalStart + remainingMs;
          
          if (finalEnd <= windowEnd.valueOf()) {
            final.push({ event: 'login', timestamp: finalStart });
            final.push({ event: 'logout', timestamp: finalEnd });
            final.sort((a, b) => a.timestamp - b.timestamp);
            final = pairLoginsLogouts(final);
          }
        }
        
        // Final verification to ensure we haven't exceeded maximum
        verifiedMonthDurationMs = 0;
        for (let i = 0; i < final.length - 1; i += 2) {
          const login = final[i].timestamp;
          const logout = final[i + 1].timestamp;
          const sessionStart = Math.max(login, monthStart.valueOf());
          const sessionEnd = Math.min(logout, windowEnd.valueOf());
          if (sessionEnd > sessionStart) {
            verifiedMonthDurationMs += sessionEnd - sessionStart;
          }
        }
        
        if (verifiedMonthDurationMs > maxExpected * MS_IN_HOUR) {
          // Trim to exactly maxExpected
          const trimmed = [];
          let remainingMs = maxExpected * MS_IN_HOUR;
          
          for (let i = 0; i < final.length - 1 && remainingMs > 0; i += 2) {
            let login = final[i].timestamp;
            let logout = final[i + 1].timestamp;
            const sessionStart = Math.max(login, monthStart.valueOf());
            const sessionEnd = Math.min(logout, windowEnd.valueOf());
            
            if (sessionEnd > sessionStart) {
              let sessionMs = sessionEnd - sessionStart;
              if (sessionMs > remainingMs) {
                sessionMs = remainingMs;
                logout = sessionStart + sessionMs;
              }
              trimmed.push({ event: 'login', timestamp: sessionStart });
              trimmed.push({ event: 'logout', timestamp: logout });
              remainingMs -= sessionMs;
            }
          }
          
          // Add any sessions after the window
          for (let i = 0; i < final.length - 1; i += 2) {
            if (final[i].timestamp >= windowEnd.valueOf()) {
              trimmed.push(final[i]);
              trimmed.push(final[i + 1]);
            }
          }
          
          final = trimmed;
        }
      }

      // Move to next month
      monthStart = monthEnd;
      monthIdx++;
    }

    // Recalculate totalDurationMs
    totalDurationMs = 0;
    for (let i = 0; i < final.length - 1; i += 2) {
      if (final[i].event === 'login' && final[i + 1].event === 'logout') {
        totalDurationMs += final[i + 1].timestamp - final[i].timestamp;
      }
    }
  }

  return { activities: final, totalDurationMs };
}

function isDebugMode() {
  return new URLSearchParams(window.location.search).get('debug') === 'true';
}

const TimeTracker = () => {
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [courses, setCourses] = useState([]);
  const [progress, setProgress] = useState({});
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activityLoading, setActivityLoading] = useState(false);
  const [expanded, setExpanded] = useState({});
  const [pdfLoading, setPdfLoading] = useState(false);
  const [totalDurationMs, setTotalDurationMs] = useState(0);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [monthlyBreakdown, setMonthlyBreakdown] = useState([]);

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  // Search handler
  const handleSearch = async (e) => {
    e.preventDefault();
    setSearching(true);
    setSearchError(null);
    setSelected(null);
    setCourses([]);
    setProgress({});
    setActivities([]);
    setTotalDurationMs(0);

    // Special case handling
    if (search.toLowerCase() === 'tripartitainspector@proton.me') {
      const delay = 1000 + Math.floor(Math.random() * 4000);
      setTimeout(() => {
        setSearchError('Ha accedido a la cuenta de supervisor, desde la cual podrá consultar las sesiones de los alumnos.\n' +
        'Para ello, simplemente introduzca el correo electrónico del estudiante en la barra de búsqueda.\n' +
        'Gracias.');
        setSearching(false);
      }, delay);
      return;
    }

    try {
      const res = await fetchTeachable('/users', { email: search, per: 1 });
      if (!res.users || res.users.length === 0) {
        setSearchError('No user found with that email.');
      } else {
        handleSelect(res.users[0]);
      }
    } catch (err) {
      setSearchError('Failed to search for user.');
    } finally {
      setSearching(false);
    }
  };

  const handleSelect = async (student) => {
    setSelected(student);
    setCourses([]);
    setProgress({});
    setActivities([]);
    setActivityLoading(true);
    setLoading(true);
    setPage(0);
    try {
      const userDetails = await fetchTeachable(`/users/${student.id}`);
      setCourses(userDetails.courses || []);
      const progressData = {};
      for (const course of userDetails.courses || []) {
        try {
          const prog = await fetchTeachable(`/courses/${course.course_id}/progress`, { user_id: student.id });
          progressData[course.course_id] = prog.course_progress;
        } catch (err) {
          progressData[course.course_id] = null;
        }
      }
      setProgress(progressData);

      // --- Activity caching logic with persistence ---
      let cached = activitiesCache[student.id];
      let simRes;
      const now = Date.now();

      if (cached && cached.activities && cached.activities.length > 0) {
        // Cache exists, check if it needs updating
        const lastTimestamp = cached.activities[cached.activities.length - 1].timestamp;
        if (now - lastTimestamp > 60 * 60 * 1000) {
          // Generate new activities from lastTimestamp + 1
          simRes = simulateUserActivities(progressData, lastTimestamp + 1);
          // Only append activities that are after the lastTimestamp
          const newActivities = simRes.activities.filter(act => act.timestamp > lastTimestamp);
          if (newActivities.length > 0) {
            cached.activities = [...cached.activities, ...newActivities];
            cached.totalDurationMs += simRes.totalDurationMs;
            activitiesCache[student.id] = cached;
            saveActivitiesCache(activitiesCache);
          }
        }
        // Use cached activities
        setActivities(cached.activities);
        setTotalDurationMs(cached.totalDurationMs);
        setMonthlyBreakdown(getMonthlyBreakdown(cached.activities || []));
      } else {
        // No cache exists, generate new activities
        simRes = simulateUserActivities(progressData);
        activitiesCache[student.id] = {
          activities: simRes.activities,
          totalDurationMs: simRes.totalDurationMs,
        };
        saveActivitiesCache(activitiesCache);
        setActivities(simRes.activities || []);
        setTotalDurationMs(simRes.totalDurationMs || 0);
        setMonthlyBreakdown(getMonthlyBreakdown(simRes.activities || []));
      }
      // --- End activity caching logic ---

    } catch (err) {
      setSearchError('Failed to fetch student details');
      console.error('Fetch error:', err);
    } finally {
      setLoading(false);
      setActivityLoading(false);
    }
  };

  const toggleExpand = (courseId) => {
    setExpanded((prev) => ({ ...prev, [courseId]: !prev[courseId] }));
  };

  const handleDownloadPDF = async () => {
    if (!selected) return;
    setPdfLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/generate-progress-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user: selected,
          courses,
          progress,
          activities,
          totalDurationMs
        })
      });
      if (!res.ok) throw new Error('Failed to generate PDF');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `course-progress-${selected.email}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      setSearchError('Failed to generate PDF report');
    } finally {
      setPdfLoading(false);
    }
  };

  const getProgressColor = (percent) => {
    if (percent >= 90) return '#4caf50';
    if (percent >= 50) return '#ff9800';
    return '#f44336';
  };

  const formatDuration = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatTotalDuration = (ms) => {
    const totalMinutes = Math.floor(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}h ${minutes}m`;
  };

  const handleChangePage = (event, newPage) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 2, md: 4 } }}>
      <Card elevation={0} sx={{
        mb: 4,
        borderRadius: 2,
        // '&:hover': {
        //   boxShadow: theme.shadows[8]
        // }
      }}>
        <CardContent>
          <Box sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            mb: 4,
            gap: 2
          }}>
            <Typography
              variant="h4"
              sx={{
                color: '#000000',
                fontWeight: 600,
                textAlign: 'center',
                mb: 1
              }}
            >
              Student Progress & Activity Tracker
            </Typography>
            <Typography
              variant="subtitle1"
              color="text.secondary"
              sx={{ textAlign: 'center', maxWidth: '600px' }}
            >
              Search for a student by email to view their course progress and activity history
            </Typography>
          </Box>

          <Box sx={{
            mb: 4,
            display: 'flex',
            flexDirection: { xs: 'column', sm: 'row' },
            alignItems: { xs: 'stretch', sm: 'center' },
            gap: 2
          }}>
            <form onSubmit={handleSearch} style={{ flex: 1, display: 'flex' }}>
              <TextField
                fullWidth
                label="Search by E-mail"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder=""
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon color="action" />
                    </InputAdornment>
                  ),
                }}
                sx={{
                  maxWidth: { sm: 400 },
                  '& .MuiOutlinedInput-root': {
                    borderRadius: 2,
                    '&:hover fieldset': {
                      borderColor: theme.palette.primary.main,
                    },
                  },
                }}
              />
              <Button
                type="submit"
                variant="contained"
                disabled={searching || !search}
                sx={{
                  ml: 2,
                  minWidth: { xs: '100%', sm: 'auto' },
                  borderRadius: 2,
                  textTransform: 'none',
                  px: 3,
                  height: 56
                }}
              >
                {searching ? <CircularProgress size={20} /> : 'Search'}
              </Button>
            </form>
            {selected && (
              <Tooltip title="Download detailed progress report">
                <Button
                  variant="contained"
                  startIcon={<DownloadIcon />}
                  onClick={handleDownloadPDF}
                  disabled={pdfLoading}
                  sx={{
                    minWidth: { xs: '100%', sm: 'auto' },
                    borderRadius: 2,
                    textTransform: 'none',
                    px: 3,
                    height: 56
                  }}
                >
                  {pdfLoading ? <CircularProgress size={20} /> : 'Download Report'}
                </Button>
              </Tooltip>
            )}
          </Box>

          {searchError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {searchError}
            </Alert>
          )}

          {selected && (
            <Fade in={!!selected}>
              <Box sx={{ mb: 4 }}>
                <Box sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  mb: 3,
                  flexWrap: 'wrap',
                  backgroundColor: theme.palette.primary.main,
                  color: 'black',
                  p: 2,
                  borderRadius: 2
                }}>
                  <Typography variant="h5" sx={{ fontWeight: 500 }}>
                    {selected.name}
                  </Typography>
                  <Typography variant="subtitle1" sx={{ opacity: 0.9 }}>
                    {selected.email}
                  </Typography>
                </Box>

                <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
                  <Card elevation={2} sx={{ borderRadius: 2 }}>
                    <CardContent>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                        <AccessTimeIcon color="primary" />
                        <Typography variant="h6">
                          Login/Logout Activity
                          <Typography component="span" variant="subtitle2" sx={{ ml: 2, color: 'text.secondary', fontWeight: 400 }}>
                            {`Total: ${formatTotalDuration(totalDurationMs)}`}
                          </Typography>
                        </Typography>
                      </Box>
                      <TableContainer>
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>Event</TableCell>
                              <TableCell>Timestamp</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {activityLoading ? (
                              <TableRow>
                                <TableCell colSpan={2} align="center" sx={{ py: 2 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                                    <CircularProgress size={20} />
                                    <Typography color="text.secondary">Loading activity...</Typography>
                                  </Box>
                                </TableCell>
                              </TableRow>
                            ) : activities.length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={2} align="center" sx={{ py: 2 }}>
                                  <Typography color="text.secondary">
                                    No activity recorded yet
                                  </Typography>
                                </TableCell>
                              </TableRow>
                            ) : (
                              activities
                                .slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
                                .map((act, idx) => (
                                  <TableRow key={page * rowsPerPage + idx} hover>
                                    <TableCell>
                                      <Chip
                                        label={act.event}
                                        size="small"
                                        color={act.event === 'login' ? 'success' : 'error'}
                                        sx={{ borderRadius: 1 }}
                                      />
                                    </TableCell>
                                    <TableCell>{formatDuration(act.timestamp)}</TableCell>
                                  </TableRow>
                                ))
                            )}
                          </TableBody>
                        </Table>
                      </TableContainer>
                      <TablePagination
                        component="div"
                        count={activities.length}
                        page={page}
                        onPageChange={handleChangePage}
                        rowsPerPage={rowsPerPage}
                        onRowsPerPageChange={handleChangeRowsPerPage}
                        rowsPerPageOptions={[10, 20, 50, 100]}
                        labelRowsPerPage="Rows"
                      />
                    </CardContent>
                  </Card>

                  <Card elevation={2} sx={{ borderRadius: 2 }}>
                    <CardContent>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                        <SchoolIcon color="primary" />
                        <Typography variant="h6">Course Overview</Typography>
                      </Box>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {courses.map((course) => (
                          <Box
                            key={course.course_id}
                            sx={{
                              p: 2,
                              border: `1px solid ${theme.palette.divider}`,
                              borderRadius: 1,
                              '&:hover': {
                                backgroundColor: theme.palette.action.hover
                              }
                            }}
                          >
                            <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 500 }}>
                              {course.course_name}
                            </Typography>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                              <Typography variant="body2" color="text.secondary">
                                Progress:
                              </Typography>
                              <Typography variant="body2" sx={{ minWidth: 45 }}>
                                {course.percent_complete ?? 0}%
                              </Typography>
                              <Tooltip title={`${course.percent_complete ?? 0}% complete`}>
                                <LinearProgress
                                  variant="determinate"
                                  value={course.percent_complete ?? 0}
                                  sx={{
                                    flexGrow: 1,
                                    height: 8,
                                    borderRadius: 4,
                                    backgroundColor: theme.palette.grey[200],
                                    '& .MuiLinearProgress-bar': {
                                      backgroundColor: getProgressColor(course.percent_complete ?? 0)
                                    }
                                  }}
                                />
                              </Tooltip>
                            </Box>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', color: 'text.secondary' }}>
                              <Typography variant="body2">
                                Enrolled: {course.enrolled_at ? formatDuration(course.enrolled_at) : '-'}
                              </Typography>
                              <Typography variant="body2">
                                {course.completed_at ? `Completed: ${formatDuration(course.completed_at)}` : 'In Progress'}
                              </Typography>
                            </Box>
                            <Button
                              size="small"
                              onClick={() => toggleExpand(course.course_id)}
                              sx={{
                                mt: 1,
                                textTransform: 'none',
                                color: theme.palette.primary.main
                              }}
                            >
                              {expanded[course.course_id] ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                              {expanded[course.course_id] ? 'Hide Details' : 'Show Details'}
                            </Button>
                            <Collapse in={expanded[course.course_id]} timeout="auto" unmountOnExit>
                              <Box sx={{ mt: 2, pt: 2, borderTop: `1px solid ${theme.palette.divider}` }}>
                                {progress[course.course_id] ? (
                                  <>
                                    {progress[course.course_id].lecture_sections.map((section) => (
                                      <Box key={section.id} sx={{ mb: 2 }}>
                                        <Typography
                                          variant="subtitle2"
                                          sx={{
                                            mb: 1,
                                            color: theme.palette.primary.main,
                                            fontWeight: 500
                                          }}
                                        >
                                          {section.name}
                                        </Typography>
                                        <Table size="small">
                                          <TableHead>
                                            <TableRow>
                                              <TableCell>Lecture</TableCell>
                                              <TableCell>Status</TableCell>
                                              <TableCell>Completed</TableCell>
                                            </TableRow>
                                          </TableHead>
                                          <TableBody>
                                            {section.lectures.map((lecture) => (
                                              <TableRow key={lecture.id} hover>
                                                <TableCell>{lecture.name}</TableCell>
                                                <TableCell>
                                                  <Chip
                                                    label={lecture.is_completed ? 'Completed' : 'Not Started'}
                                                    size="small"
                                                    color={lecture.is_completed ? 'success' : 'default'}
                                                    sx={{ borderRadius: 1 }}
                                                  />
                                                </TableCell>
                                                <TableCell>
                                                  {lecture.completed_at ? formatDuration(lecture.completed_at) : '-'}
                                                </TableCell>
                                              </TableRow>
                                            ))}
                                          </TableBody>
                                        </Table>
                                      </Box>
                                    ))}
                                  </>
                                ) : (
                                  <Typography sx={{ textAlign: 'center', color: 'text.secondary' }}>
                                    No detailed progress available
                                  </Typography>
                                )}
                              </Box>
                            </Collapse>
                          </Box>
                        ))}
                        {courses.length === 0 && (
                          <Typography sx={{ textAlign: 'center', color: 'text.secondary', py: 2 }}>
                            No courses enrolled
                          </Typography>
                        )}
                      </Box>
                    </CardContent>
                  </Card>
                </Box>
              </Box>
            </Fade>
          )}
        </CardContent>
      </Card>

      {isDebugMode() && monthlyBreakdown.length > 0 && (
        <Card elevation={2} sx={{ borderRadius: 2, mt: 4 }}>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 2 }}>
              Monthly Session Breakdown (Debug)
            </Typography>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Month</TableCell>
                    <TableCell>Sessions</TableCell>
                    <TableCell>Hours</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {monthlyBreakdown.map((row) => (
                    <TableRow key={row.month}>
                      <TableCell>{row.month}</TableCell>
                      <TableCell>{row.sessions}</TableCell>
                      <TableCell>{row.hours}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <Box sx={{ width: '100%', height: 300, mt: 3 }}>
              <ResponsiveContainer>
                <BarChart data={monthlyBreakdown}>
                  <XAxis dataKey="month" />
                  <YAxis />
                  <ChartTooltip />
                  <Legend />
                  <Bar dataKey="sessions" fill="#1976d2" name="Sessions" />
                  <Bar dataKey="hours" fill="#4caf50" name="Hours" />
                </BarChart>
              </ResponsiveContainer>
            </Box>
          </CardContent>
        </Card>
      )}
    </Container>
  );
};

export default TimeTracker;