import React, { useState, useEffect } from 'react';
import { Box, Button, TextField, Typography, Paper } from '@mui/material';

const defaultSettings = {
  systemPromptInstructor: '',
  systemPromptClassmate: '',
  // Add other settings fields as needed
};

const AdminPage = () => {
  const [settings, setSettings] = useState(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  useEffect(() => {
    // Fetch current settings from backend
    fetch('/api/admin/settings')
      .then(res => res.json())
      .then(data => {
        setSettings(data);
        setLoading(false);
      })
      .catch(() => {
        setMessage('Failed to load settings.');
        setLoading(false);
      });
  }, []);

  const handleChange = (e) => {
    setSettings({ ...settings, [e.target.name]: e.target.value });
  };

  const handleSave = () => {
    setMessage('');
    fetch('/api/admin/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    })
      .then(res => res.json())
      .then(data => setMessage('Settings saved!'))
      .catch(() => setMessage('Failed to save settings.'));
  };

  const handleReset = () => {
    setLoading(true);
    fetch('/api/admin/settings')
      .then(res => res.json())
      .then(data => {
        setSettings(data);
        setLoading(false);
      });
  };

  if (loading) return <Typography>Loading...</Typography>;

  return (
    <Box sx={{ maxWidth: 600, margin: '40px auto' }}>
      <Paper sx={{ p: 4 }}>
        <Typography variant="h4" gutterBottom>Admin Settings</Typography>
        <TextField
          label="Instructor System Prompt"
          name="systemPromptInstructor"
          value={settings.systemPromptInstructor}
          onChange={handleChange}
          fullWidth
          multiline
          minRows={2}
          sx={{ mb: 2 }}
        />
        <TextField
          label="Classmate System Prompt"
          name="systemPromptClassmate"
          value={settings.systemPromptClassmate}
          onChange={handleChange}
          fullWidth
          multiline
          minRows={2}
          sx={{ mb: 2 }}
        />
        {/* Add more fields for other settings here */}
        <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
          <Button variant="contained" color="primary" onClick={handleSave}>Save</Button>
          <Button variant="outlined" onClick={handleReset}>Reset</Button>
        </Box>
        {message && <Typography sx={{ mt: 2 }}>{message}</Typography>}
      </Paper>
    </Box>
  );
};

export default AdminPage; 