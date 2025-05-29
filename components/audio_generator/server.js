const { GoogleGenerativeAI } = require('@google/generative-ai');
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const wav = require('wav');
const NodeCache = require('node-cache');

const cache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });

const CONFIG = {
  AUDIO_OUTPUT_DIR: path.join(__dirname, '../../public/generated_audio'),
  GEMINI_API_KEY: 'AIzaSyBsQnaUc2IwbtUIQa9maEQ5jGU0BZD1oXc',
  TTS_MODEL: 'gemini-2.5-flash-preview-tts',
  VOICE_CONFIG: {
    voiceName: 'Sadaltager'
  },
  AUDIO_FORMAT: {
    channels: 1,
    sampleRate: 24000,
    bitDepth: 16
  }
};

const genAI = new GoogleGenerativeAI(CONFIG.GEMINI_API_KEY);
const firestore = admin.firestore();

const ensureArticleAudioDir = (articleId) => {
  const articleDir = path.join(CONFIG.AUDIO_OUTPUT_DIR, articleId);
  if (!fs.existsSync(articleDir)) {
    fs.mkdirSync(articleDir, { recursive: true });
  }
  return articleDir;
};

const saveAudioFile = (filename, audioData) => {
  return new Promise((resolve, reject) => {
    const writer = new wav.FileWriter(filename, {
      channels: CONFIG.AUDIO_FORMAT.channels,
      sampleRate: CONFIG.AUDIO_FORMAT.sampleRate,
      bitDepth: CONFIG.AUDIO_FORMAT.bitDepth
    });

    writer.on('finish', () => {
      const webPath = filename.replace(/^.*public/, '');
      resolve(webPath);
    });
    writer.on('error', reject);

    writer.write(audioData);
    writer.end();
  });
};

const generateTTSAudio = async (text, retries = 3) => {
  const cacheKey = `audio_${text.substring(0, 100)}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const model = genAI.getGenerativeModel({ model: CONFIG.TTS_MODEL });

    const result = await model.generateContent({
      contents: [{
        role: 'user',
        parts: [{ text: `Read the following like a professional Nepali breaking news anchor. Speak in Nepali with clear pronunciation, fast pace, and slight urgency in your tone—just like on TV. Keep it engaging and serious, but not robotic. This is for a short TikTok video, so your voice must grab attention quickly and deliver the message confidently. Begin with a slightly dramatic pause and emphasis on keywords.  ${text}` }]
      }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: CONFIG.VOICE_CONFIG
          }
        }
      }
    });

    const response = await result.response;
    const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

    if (!audioData) {
      throw new Error('No audio data received from Gemini TTS');
    }

    const buffer = Buffer.from(audioData, 'base64');
    cache.set(cacheKey, buffer);
    return buffer;
  } catch (error) {
    if (retries > 0) {
      console.warn(`Retrying TTS generation (${retries} left): ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, 2000 * (4 - retries)));
      return generateTTSAudio(text, retries - 1);
    }
    throw error;
  }
};

const getArticlesForAudioGeneration = async () => {
  try {
    const snapshot = await firestore
      .collection('news_articles')
      .where('audio_generated', '==', false)
      .where('paraphrased_content', '!=', null)
      .get();

    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
  } catch (error) {
    console.error('Error fetching articles:', error);
    throw error;
  }
};

const processArticleAudio = async (article) => {
  const articleDir = ensureArticleAudioDir(article.uuid);
  const audioFilename = path.join(articleDir, 'audio.wav');

  try {
    // Combine title and content for TTS
    const ttsText = `${article.paraphrased_title}.\n ${article.paraphrased_content}`;
    const audioBuffer = await generateTTSAudio(ttsText);
    const webPath = await saveAudioFile(audioFilename, audioBuffer);

    return {
      success: true,
      audio_path: webPath,
      audio_generated_at: new Date().toISOString()
    };
  } catch (error) {
    console.error(`Failed to generate audio for article ${article.uuid}: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
};

const updateArticleWithAudio = async (articleId, audioData) => {
  if (audioData.success) {
    await firestore.collection('news_articles').doc(articleId).update({
      audio_path: audioData.audio_path,
      audio_generated: true,
      audio_generated_at: admin.firestore.FieldValue.serverTimestamp(),
      firebase_updated_at: admin.firestore.FieldValue.serverTimestamp()
    });
  } else {
    await firestore.collection('news_articles').doc(articleId).update({
      audio_generation_error: audioData.error,
      firebase_updated_at: admin.firestore.FieldValue.serverTimestamp()
    });
  }
};

const generateAudioForArticles = async (maxArticles = 5) => {
  try {
    const articles = await getArticlesForAudioGeneration();
    if (articles.length === 0) {
      console.log('No articles found needing audio generation');
      return [];
    }

    const results = [];
    for (const article of articles.slice(0, maxArticles)) {
      try {
        console.log(`Processing audio for article ${article.uuid}`);
        const audioResult = await processArticleAudio(article);
        await updateArticleWithAudio(article.id, audioResult);

        results.push({
          article_id: article.id,
          uuid: article.uuid,
          success: audioResult.success,
          audio_path: audioResult.audio_path || null,
          error: audioResult.error || null
        });

        // Rate limiting between audio generations
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`Error processing article ${article.uuid}: ${error.message}`);
        results.push({
          article_id: article.id,
          uuid: article.uuid,
          success: false,
          error: error.message
        });
      }
    }

    console.log(`Completed audio generation for ${results.filter(r => r.success).length}/${results.length} articles`);
    return results;
  } catch (error) {
    console.error('Audio generation process failed:', error);
    throw error;
  }
};

module.exports = {
  generateAudioForArticles,
  // For testing/monitoring
  _private: {
    getArticlesForAudioGeneration,
    generateTTSAudio,
    processArticleAudio
  }
};