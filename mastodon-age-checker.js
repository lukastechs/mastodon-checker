const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;
const instances = process.env.MASTODON_INSTANCES ? process.env.MASTODON_INSTANCES.split(',') : ['mastodon.social', 'fosstodon.org', 'mstdn.social'];

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

// Process profile data into response format
function processProfileData(profile, instanceUsed) {
  const avatarUrl = profile.avatar_static || profile.avatar || `https://${instanceUsed}/avatars/original/missing.png`;
  return {
    username: profile.username,
    nickname: profile.display_name || profile.username,
    estimated_creation_date: new Date(profile.created_at).toLocaleDateString(),
    account_age: calculateAccountAge(profile.created_at),
    age_days: calculateAgeDays(profile.created_at),
    followers: profile.followers_count.toString(),
    total_posts: profile.statuses_count.toString(),
    verified: profile.bot ? 'Bot Account' : (profile.locked ? 'Protected' : 'Standard'),
    description: profile.note.replace(/<[^>]*>/g, ''),
    region: 'N/A',
    user_id: profile.id,
    avatar: avatarUrl,
    estimation_confidence: 'High (exact server timestamp)',
    accuracy_range: 'Second-level (ISO 8601 timestamp)',
    profile_link: profile.url || `https://${instanceUsed}/@${profile.username}`,
    instance_used: instanceUsed
  };
}

// Fetch Mastodon user profile from a single instance
async function fetchFromInstance(username, instance) {
  try {
    const apiUrl = `https://${instance}/api/v1/accounts/lookup?acct=${encodeURIComponent(username)}`;
    const response = await axios.get(apiUrl, {
      timeout: 5000,
      headers: { 'User-Agent': 'SocialAgeChecker/1.0' }
    });
    return { data: response.data, instanceUsed: instance };
  } catch (error) {
    return { error, instanceUsed: instance };
  }
}

// Fetch Mastodon user profile by handle (username or username@instance)
async function getMastodonProfile(handle) {
  const isFullHandle = handle.includes('@');
  const [username] = handle.split('@');

  if (isFullHandle) {
    const [, instance] = handle.split('@');
    return await fetchFromInstance(username, instance);
  }

  // Try all configured instances for username-only
  const promises = instances.map(instance => fetchFromInstance(username, instance));
  const results = await Promise.all(promises);
  const successes = results.filter(result => result.data && result.data.id);
  const errors = results.filter(result => result.error);

  if (successes.length === 0) {
    throw new Error(`No account found for ${username} on instances: ${instances.join(', ')}`);
  }

  return successes;
}

// Root endpoint
app.get('/', (req, res) => {
  res.send(`Mastodon Account Age Checker API is running (instances: ${instances.join(', ')})`);
});

// Mastodon age checker endpoint (GET)
app.get('/api/mastodon/:handle', async (req, res) => {
  const { handle } = req.params;
  if (!handle) {
    return res.status(400).json({ error: 'Handle is required (e.g., gargron or gargron@mastodon.social)' });
  }

  // Validate handle: username@instance or username (3-30 chars username, valid domain if provided)
  const handleRegex = /^[a-zA-Z0-9_]{3,30}(@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})?$/;
  if (!handleRegex.test(handle)) {
    return res.status(400).json({ 
      error: `Invalid Mastodon handle format. Use username (3-30 chars, letters/numbers/underscores) or username@instance.social. Searched instances: ${instances.join(', ')}.`
    });
  }

  try {
    const result = await getMastodonProfile(handle);

    // Single instance (full handle) or single match
    if (!Array.isArray(result)) {
      if (result.error) {
        const instance = handle.includes('@') ? handle.split('@')[1] : instances[0];
        return res.status(result.error.response?.status || 404).json({ 
          error: `Mastodon account ${handle} not found, suspended, or instance ${instance} unavailable`
        });
      }
      const profileData = processProfileData(result.data, result.instanceUsed);
      return res.json(profileData);
    }

    // Multiple matches across instances
    if (result.length > 1) {
      const profiles = result.map(r => ({
        ...processProfileData(r.data, r.instanceUsed),
        estimation_confidence: 'Medium (multiple instances found)'
      }));
      return res.json({
        users: profiles,
        note: `Multiple accounts found for ${handle.split('@')[0]}. Use instance_used or profile_link to select the correct account.`
      });
    }

    // Single match from multiple instances
    const profileData = processProfileData(result[0].data, result[0].instanceUsed);
    res.json(profileData);
  } catch (error) {
    console.error('Mastodon API Error:', {
      message: error.message,
      instances: instances.join(', ')
    });
    res.status(500).json({
      error: error.message || 'Failed to fetch Mastodon data',
      details: `Searched instances: ${instances.join(', ')}`
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
