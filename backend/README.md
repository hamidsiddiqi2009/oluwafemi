# Teachable Chat Widget Backend

## Environment Variables Setup

This backend requires the following environment variables to be configured. Create a `.env` file in the backend directory with the following variables:

### Required Environment Variables

```env
# OpenAI API Configuration
OPENAI_API_KEY=your_openai_api_key_here

# Teachable API Configuration
TEACHABLE_API_KEY=your_teachable_api_key_here

# Server Configuration
PORT=3001
NODE_ENV=development
```

### Getting API Keys

1. **OpenAI API Key**: 
   - Sign up at https://platform.openai.com/
   - Create an API key in your account settings
   - The key should start with `sk-`

2. **Teachable API Key**:
   - Access your Teachable school admin panel
   - Go to Settings > API
   - Generate a new API key

### Installation and Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env` file with your API keys

3. Start the development server:
   ```bash
   npm run dev
   ```

4. The server will start on port 3001 (or the port specified in your .env file)

### Security Notes

- Never commit your `.env` file to version control
- The `.env` file is already included in `.gitignore`
- Use different API keys for development and production environments 