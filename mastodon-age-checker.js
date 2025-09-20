const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Calculate account age in human-readable format
function calculateAccountAge(createdAt) {
  const now = new Date();
  const created = new Date(createdAt);
  const diffMs = now - created;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const years = Math.floor(diffDays / 365);
  const months = Math.floor((diffDays % 365) / 30);
  return years > 0 ? `${years} years, ${months} months` : `${months} months`;
}

// Calculate age in days
function calculateAgeDays(createdAt) {
  const now = new Date();
  const created = new Date(createdAt);
  const diffMs = now - created;
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

// Fetch Mastodon user profile by handle (username@instance)
async function getMastodonProfile(handle) {
  try {
    // Default to popular instance if no @domain
    if (!handle.includes('@')) {
      handle = `${handle}@mastodon.social`;
    }

    const [username, instance] = handle.split('@');
    const apiUrl = `https://${instance}/api/v1/accounts/lookup?acct=${encodeURIComponent(username)}`;

    const response = await axios.get(apiUrl, {
      timeout: 5000,
      headers: { 'User-Agent': 'SocialAgeChecker/1.0' } // Polite user agent
    });
    return response.data;
  } catch (error) {
    console.error('Mastodon API Error:', {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message,
      url: error.config?.url
    });
    throw error;
  }
}

// Root endpoint
app.get('/', (req, res) => {
  res.send('Mastodon Account Age Checker API is running');
});

// Mastodon age checker endpoint (GET)
app.get('/api/mastodon/:handle', async (req, res) => {
  const { handle } = req.params;
  if (!handle) {
    return res.status(400).json({ error: 'Handle is required (e.g., gargron@mastodon.social)' });
  }

  // Basic validation for Mastodon handle (username@instance, 3-30 chars username, valid domain)
  const handleRegex = /^[a-zA-Z0-9_]{3,30}@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!handleRegex.test(handle)) {
    return res.status(400).json({ error: 'Invalid Mastodon handle format. Use username@instance.social (3-30 chars username, valid domain).' });
  }

  try {
    const profile = await getMastodonProfile(handle);

    if (!profile || !profile.id) {
      return res.status(404).json({ error: `Mastodon account ${handle} not found or suspended` });
    }

    // Generate avatar URL if missing (fallback to instance default)
    const avatarUrl = profile.avatar_static || profile.avatar || `https://${handle.split('@')[1]}/avatars/original/missing.png`;

    res.json({
      username: profile.username,
      nickname: profile.display_name || profile.username,
      estimated_creation_date: new Date(profile.created_at).toLocaleDateString(),
      account_age: calculateAccountAge(profile.created_at),
      age_days: calculateAgeDays(profile.created_at),
      followers: profile.followers_count.toString(),
      total_posts: profile.statuses_count.toString(), // Public toots/posts
      verified: profile.bot ? 'Bot Account' : (profile.locked ? 'Protected' : 'Standard'),
      description: profile.note.replace(/<[^>]*>/g, ''), // Strip HTML from bio
      region: 'N/A', // No location field in public API
      user_id: profile.id,
      avatar: avatarUrl,
      estimation_confidence: 'High (exact server timestamp)',
      accuracy_range: 'Second-level (ISO 8601 timestamp)',
      profile_link: profile.url || `https://${handle.split('@')[1]}/@${profile.username}`
    });
  } catch (error) {
    if (error.response?.status === 404 || error.response?.status === 403) {
      return res.status(404).json({ error: `Mastodon account ${handle} not found, suspended, or instance unavailable` });
    }

    console.error('Mastodon API Error:', {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message
    });
    res.status(error.response?.status || 500).json({
      error: error.message || 'Failed to fetch Mastodon data',
      details: error.response?.data || 'No additional details'
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.listen(port, () => {
  console.log(`Mastodon Account Age Checker Server running on port ${port}`);
});
