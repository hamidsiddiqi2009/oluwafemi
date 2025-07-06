import React, { useState, useEffect, useRef } from 'react';
import { Box, Button, Modal, TextField, Typography, List, ListItem, ListItemText, Divider, Drawer, MenuItem, Select, CircularProgress, Fade, Grow, Slide } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';

const ChatWidget = () => {
  const [openRoleModal, setOpenRoleModal] = useState(true);
  const [role, setRole] = useState('');
  const [email, setEmail] = useState('');
  const [chatMessages, setChatMessages] = useState([]);
  const [message, setMessage] = useState('');
  const [pdfPanelOpen, setPdfPanelOpen] = useState(false);
  const [searchEmail, setSearchEmail] = useState('');
  const [classmates, setClassmates] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [selectedParticipant, setSelectedParticipant] = useState('Instructor Alex');
  const [loading, setLoading] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [pdfList, setPdfList] = useState([]);
  const [pdfListLoading, setPdfListLoading] = useState(false);
  const chatEndRef = useRef(null);

  // Fetch classmates on load or when role/email changes
  useEffect(() => {
    if (email) {
      fetch('/api/classmates')
        .then(res => res.json())
        .then(data => {
          setClassmates(data.classmates || []);
          setOnlineUsers(data.classmates || []);
        });
    }
  }, [role, email]);

  // Periodically refresh online users
  useEffect(() => {
    if (email) {
      const interval = setInterval(() => {
        fetch('/api/classmates')
          .then(res => res.json())
          .then(data => {
            setClassmates(data.classmates || []);
            setOnlineUsers(data.classmates || []);
          });
      }, 30000); // Refresh every 30 seconds
      
      return () => clearInterval(interval);
    }
  }, [role]);

  // AI classmates ask questions to the student
  useEffect(() => {
    if (email && !sessionEnded && classmates.length > 0) {
      let timerId;
      const askStudentQuestion = async () => {
        // Pick a random classmate
        const classmate = classmates[Math.floor(Math.random() * classmates.length)];
        // Generate a random question for the student
        const questions = [
          'What do you think about the last topic we discussed?',
          'Have you started working on the assignment yet?',
          'Do you understand the concept we just learned?',
          'What questions do you have about the material?',
          'How are you finding the course so far?',
          'Would you like to study together for the upcoming quiz?',
          'What part of the lesson did you find most interesting?',
          'Do you need help with anything specific?'
        ];
        const randomQuestion = questions[Math.floor(Math.random() * questions.length)];
        const timestamp = new Date().toLocaleString();
        
        // Add the classmate's question to the chat
        setChatMessages(prev => [
          ...prev,
          {
            sender: classmate.name,
            role: 'classmate',
            participant: email,
            message: randomQuestion,
            timestamp
          }
        ]);
        
        // Schedule next question
        timerId = setTimeout(askStudentQuestion, 45000 + Math.random() * 30000); // 45-75s
      };
      
      // Start the first question after a delay
      timerId = setTimeout(askStudentQuestion, 15000 + Math.random() * 15000); // 15-30s
      
      return () => clearTimeout(timerId);
    }
  }, [role, sessionEnded, classmates, email]);

  // Modal: handle email entry and continue
  const handleContinue = () => {
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setEmailError('Please enter a valid email address.');
      return;
    }
    setEmailError('');
    setRole('student'); // Default to student role
    setOpenRoleModal(false);
  };

  // Send message to backend and get AI/classmate response
  const handleSendMessage = async () => {
    if (!message.trim() || sessionEnded) return;
    const timestamp = new Date().toLocaleString();
    const userMsg = {
      sender: email,
      role,
      participant: selectedParticipant,
      message: message,
      timestamp
    };
    // Add user message with email (will be replaced with real name from backend)
    setChatMessages(prev => [...prev, { ...userMsg, displayName: email }]);
    setMessage('');
    setLoading(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role, message, participant: selectedParticipant })
      });
      const data = await res.json();
      setLoading(false);
      if (data.error) {
        setChatMessages(prev => [...prev, { sender: 'System', message: data.error, timestamp: new Date().toLocaleString(), role: 'system' }]);
        return;
      }
      // Update the user's message with the real display name
      setChatMessages(prev => prev.map(msg => 
        msg.sender === email && msg.message === message 
          ? { ...msg, displayName: data.displayName || email }
          : msg
      ));
      setChatMessages(prev => [
        ...prev,
        {
          sender: selectedParticipant,
          message: data.reply,
          timestamp: new Date().toLocaleString(),
          role: selectedParticipant === 'Instructor Alex' ? 'instructor' : 'classmate',
          participant: email
        }
      ]);
    } catch (err) {
      setLoading(false);
      setChatMessages(prev => [...prev, { sender: 'System', message: 'Error contacting server.', timestamp: new Date().toLocaleString(), role: 'system' }]);
    }
  };

  // Fetch list of PDFs for an email
  const handleSearchTranscripts = async () => {
    if (!searchEmail) return;
    setPdfListLoading(true);
    setPdfList([]);
    try {
      const res = await fetch(`/api/pdf/list?email=${encodeURIComponent(searchEmail)}`);
      const data = await res.json();
      setPdfList(data.pdfs || []);
    } catch (err) {
      setPdfList([]);
    }
    setPdfListLoading(false);
  };

  // Download a specific PDF
  const handleDownloadSpecificPDF = async (file) => {
    if (!searchEmail || !file) return;
    setDownloading(true);
    try {
      const res = await fetch(`/api/pdf?email=${encodeURIComponent(searchEmail)}&file=${encodeURIComponent(file)}`);
      if (!res.ok) throw new Error('PDF not found');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert('PDF not found for this email.');
    }
    setDownloading(false);
  };

  // AI classmates interact with instructor
  useEffect(() => {
    if (email && !sessionEnded && classmates.length > 0) {
      let timerId;
      const sendClassmateMessage = async () => {
        // Pick a random classmate
        const classmate = classmates[Math.floor(Math.random() * classmates.length)];
        // Generate a random prompt for the classmate to ask the instructor
        const prompts = [
          'Can you explain the last topic again?',
          'I am confused about the assignment.',
          'What resources do you recommend for further study?',
          'How do I submit my homework?',
          'Can you give an example for the last concept?',
          'Is there a quiz next week?',
          'How can I improve my understanding?',
          'Can you clarify the grading policy?'
        ];
        const randomPrompt = prompts[Math.floor(Math.random() * prompts.length)];
        const timestamp = new Date().toLocaleString();
        // Add the classmate's message to the chat
        setChatMessages(prev => [
          ...prev,
          {
            sender: classmate.name,
            role: 'classmate',
            participant: 'Instructor Alex',
            message: randomPrompt,
            timestamp
          }
        ]);
        // Get AI-generated instructor reply
        try {
          const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email,
              role: 'instructor',
              message: randomPrompt,
              participant: 'Instructor Alex'
            })
          });
          const data = await res.json();
          if (!data.error) {
            setChatMessages(prev => [
              ...prev,
              {
                sender: 'Instructor Alex',
                role: 'instructor',
                participant: classmate.name,
                message: data.reply,
                timestamp: new Date().toLocaleString()
              }
            ]);
          }
        } catch (err) {
          // Ignore errors
        }
        // Schedule next message
        timerId = setTimeout(sendClassmateMessage, 30000 + Math.random() * 60000); // 30–90s
      };
      // Start the first message after a short delay
      timerId = setTimeout(sendClassmateMessage, 10000 + Math.random() * 10000); // 10–20s
      return () => clearTimeout(timerId);
    }
  }, [role, sessionEnded, classmates, email]);

  // Scroll to bottom when chatMessages change
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages]);

  return (
    <Box sx={{ width: '100vw', height: '100vh', minHeight: '100vh', minWidth: '100vw', bgcolor: '#3becb9', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Role/email modal - two steps */}
      <Modal open={openRoleModal}>
        <Box sx={{ p: 4, bgcolor: '#3becb9', borderRadius: 4, mx: 'auto', my: '20vh', width: 340, display: 'flex', flexDirection: 'column', gap: 2, boxShadow: 8 }}>
          <Typography variant="h6" sx={{ color: '#fff' }}>Enter your email</Typography>
          <TextField
            label="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            error={!!emailError}
            helperText={emailError}
            fullWidth
            autoFocus
            sx={{ bgcolor: '#3becb9', borderRadius: 2, color: '#fff', input: { color: '#fff' } }}
          />
          <Button variant="contained" onClick={handleContinue} sx={{ mt: 2, bgcolor: '#09a59a', color: '#fff', '&:hover': { bgcolor: '#3becb9', color: '#09a59a' } }}>Continue</Button>
        </Box>
      </Modal>

      {/* Main chat area with side panel */}
      <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Online users side panel */}
        <Box sx={{ width: 250, bgcolor: '#09a59a', borderRight: '1px solid #09a59a', p: 2, overflowY: 'auto' }}>
          <Typography variant="h6" sx={{ mb: 2, color: '#fff' }}>Online Users</Typography>
          {onlineUsers.map((user, idx) => (
            <Box key={idx} sx={{ 
              display: 'flex', 
              alignItems: 'center', 
              p: 1, 
              mb: 1, 
              borderRadius: 2, 
              bgcolor: '#3becb9',
              boxShadow: 1
            }}>
              <Box sx={{ 
                width: 8, 
                height: 8, 
                borderRadius: '50%', 
                bgcolor: '#09a59a', 
                mr: 1 
              }} />
              <Typography variant="body2" sx={{ flex: 1, color: '#09a59a', fontWeight: 600 }}>{user.name}</Typography>
              <Typography variant="caption" sx={{ color: '#fff' }}>Connected</Typography>
            </Box>
          ))}
          {onlineUsers.length === 0 && (
            <Typography variant="body2" sx={{ color: '#fff', fontStyle: 'italic' }}>
              No users online
            </Typography>
          )}
        </Box>

        {/* Chat area */}
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <Box sx={{ p: 2, flex: 1, overflowY: 'auto', minHeight: 0, borderRadius: 4, boxShadow: 3, m: 2, bgcolor: '#3becb9' }}>
            <Typography variant="h6" sx={{ color: '#09a59a', fontWeight: 700 }}>Chat</Typography>
            {email && (
              <Box sx={{ mb: 1 }}>
                <Typography variant="body2" sx={{ color: '#09a59a' }}>Chat with:</Typography>
                <Select
                  value={selectedParticipant}
                  onChange={e => setSelectedParticipant(e.target.value)}
                  size="small"
                  sx={{ minWidth: 180, borderRadius: 2, bgcolor: '#3becb9', boxShadow: 1, color: '#09a59a', fontWeight: 600 }}
                >
                  <MenuItem value="Instructor Alex">Instructor Alex</MenuItem>
                  {classmates.map(user => (
                    <MenuItem key={user.name} value={user.name}>{user.name}</MenuItem>
                  ))}
                </Select>
              </Box>
            )}
            <List sx={{ display: 'flex', flexDirection: 'column' }}>
              {chatMessages.map((msg, idx) => {
                let bgColor = '#3becb9';
                let textColor = '#fff';
                if (msg.role === 'instructor' || msg.sender === 'Instructor Alex') bgColor = '#09a59a';
                else if (msg.role === 'classmate') bgColor = '#3becb9';
                else if (msg.sender === email) { bgColor = '#09a59a'; }
                else if (msg.role === 'system') { bgColor = '#09a59a'; }
                return (
                  <Slide in={true} direction={msg.sender === email ? 'left' : 'right'} timeout={400 + idx * 80} key={idx}>
                    <Grow in={true} timeout={400 + idx * 80} style={{ transformOrigin: msg.sender === email ? 'right' : 'left' }}>
                      <ListItem disableGutters alignItems="flex-start" sx={{
                        justifyContent: msg.sender === email ? 'flex-end' : 'flex-start',
                        display: 'flex',
                      }}>
                        <Box
                          sx={{
                            bgcolor: bgColor,
                            borderRadius: msg.sender === email ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                            mb: 1,
                            px: 2,
                            py: 1.5,
                            maxWidth: '80%',
                            minWidth: 80,
                            boxShadow: 2,
                            position: 'relative',
                            alignSelf: msg.sender === email ? 'flex-end' : 'flex-start',
                            transition: 'box-shadow 0.3s',
                            '&:after': {
                              content: '""',
                              position: 'absolute',
                              width: 0,
                              height: 0,
                              borderStyle: 'solid',
                              top: '18px',
                              right: msg.sender === email ? '-12px' : 'auto',
                              left: msg.sender === email ? 'auto' : '-12px',
                              borderWidth: msg.sender === email ? '8px 0 8px 12px' : '8px 12px 8px 0',
                              borderColor: msg.sender === email
                                ? `transparent transparent transparent ${bgColor}`
                                : `transparent ${bgColor} transparent transparent`,
                            },
                          }}
                        >
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                            <Typography variant="caption" sx={{ color: textColor, fontWeight: 600 }}>
                              {msg.sender === email ? (msg.displayName || email) : msg.sender}
                            </Typography>
                            <Typography variant="caption" sx={{ color: textColor, fontSize: 11 }}>{msg.timestamp}</Typography>
                          </Box>
                          <Typography variant="body1" sx={{ fontSize: 18, color: textColor, wordBreak: 'break-word' }}>{msg.message}</Typography>
                        </Box>
                      </ListItem>
                    </Grow>
                  </Slide>
                );
              })}
              <div ref={chatEndRef} />
            </List>
            {loading && <CircularProgress size={24} sx={{ mt: 2 }} />}
            {sessionEnded && <Typography color="error" sx={{ mt: 2 }}>Session ended.</Typography>}
          </Box>
          <Divider />
          <Box sx={{ display: 'flex', p: 1, borderRadius: 4, boxShadow: 2, bgcolor: '#09a59a', m: 2 }}>
            <TextField
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Type your message..."
              fullWidth
              disabled={sessionEnded}
              onKeyDown={e => e.key === 'Enter' && handleSendMessage()}
              sx={{ bgcolor: '#09a59a', borderRadius: 2, color: '#fff', input: { color: '#fff', fontWeight: 600 } }}
            />
            <Button onClick={handleSendMessage} variant="contained" sx={{ ml: 1, bgcolor: '#09a59a', color: '#fff', '&:hover': { bgcolor: '#3becb9', color: '#09a59a' } }} disabled={sessionEnded || loading}>Send</Button>
            {!sessionEnded && (
              <Button
                onClick={async () => {
                  setSessionEnded(true);
                  // Save chat log to PDF
                  if (email && chatMessages.length > 0) {
                    await fetch('/api/pdf', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ email, chatLog: chatMessages })
                    });
                  }
                }}
                variant="outlined"
                color="error"
                sx={{ ml: 1, bgcolor: '#3becb9', color: '#fff', borderColor: '#09a59a', '&:hover': { bgcolor: '#09a59a', color: '#fff' } }}
              >
                End Session
              </Button>
            )}
          </Box>
          <Divider />
          {/* Sidebar for PDF search/download */}
          <Button startIcon={<DownloadIcon />} onClick={() => setPdfPanelOpen(true)} sx={{ m: 1, bgcolor: '#09a59a', color: '#fff', '&:hover': { bgcolor: '#3becb9', color: '#09a59a' } }}>Download Transcript</Button>
          <Drawer anchor="right" open={pdfPanelOpen} onClose={() => setPdfPanelOpen(false)}>
            <Box sx={{ width: 320, p: 2, borderRadius: 4, boxShadow: 4, bgcolor: '#3becb9', minHeight: '100vh' }}>
              <Typography variant="h6" sx={{ color: '#09a59a' }}>Search Transcript</Typography>
              <TextField label="Student Email" value={searchEmail} onChange={e => setSearchEmail(e.target.value)} fullWidth sx={{ my: 2, bgcolor: '#09a59a', borderRadius: 2, color: '#fff', input: { color: '#fff' } }} />
              <Button variant="contained" startIcon={<DownloadIcon />} onClick={handleSearchTranscripts} disabled={pdfListLoading} sx={{ bgcolor: '#09a59a', color: '#fff', '&:hover': { bgcolor: '#3becb9', color: '#09a59a' } }}>{pdfListLoading ? 'Searching...' : 'List Transcripts'}</Button>
              {pdfList.length > 0 && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="subtitle1">Available Transcripts:</Typography>
                  {pdfList.map(({ file, timestamp }) => (
                    <Box key={file} sx={{ display: 'flex', alignItems: 'center', my: 1 }}>
                      <Typography sx={{ flex: 1, fontSize: 14 }}>{file.replace('.pdf', '').replace(/-/g, ':')}</Typography>
                      <Button size="small" onClick={() => handleDownloadSpecificPDF(file)} disabled={downloading} startIcon={<DownloadIcon />}
                        sx={{ borderRadius: 3, transition: 'background 0.2s', bgcolor: '#09a59a', color: '#fff', '&:hover': { bgcolor: '#3becb9', color: '#09a59a' } }}
                      >Download</Button>
                    </Box>
                  ))}
                </Box>
              )}
              {pdfList.length === 0 && !pdfListLoading && (
                <Typography variant="body2" sx={{ mt: 2 }}>No transcripts found.</Typography>
              )}
            </Box>
          </Drawer>
        </Box>
      </Box>
    </Box>
  );
};

export default ChatWidget;
