// server/modules/remotion/render.js
const { renderMedia, selectComposition } = require('@remotion/renderer');
const { bundle } = require('@remotion/bundler');
const path = require('path');
const fs = require('fs');
const { getAudioDurationInSeconds } = require('get-audio-duration');
const os = require('os');

async function getAudioDuration(audioPath) {
  try {
    // Handle both web paths and filesystem paths
    const fullPath = audioPath.startsWith('/') 
      ? path.join(process.cwd(), 'public', audioPath)
      : audioPath;
      
    const duration = await getAudioDurationInSeconds(fullPath);
    return Math.ceil(duration);
  } catch (error) {
    console.error('Error getting audio duration:', error);
    return 10; // Default fallback duration in seconds
  }
}

async function renderVideo({ 
  title,
  content,
  imageUrls,
  audioPath,
  outputPath,
  fps = 30,
  volume = 0.3,
  imageDisplayTime = 2.5,
  transitionDuration = 0.5,
  zoomIntensity = 0.04
}) {
  try {
    // 1. Validate inputs
    if (!imageUrls?.length) throw new Error('No valid images provided');
    if (!audioPath) throw new Error('No audio path provided');

    // 2. Get actual audio duration
    const audioDuration = await getAudioDuration(audioPath);
    const durationInFrames = Math.ceil(audioDuration * fps);

    console.log(`Audio duration: ${audioDuration}s (${durationInFrames} frames)`);

    // 3. Bundle Remotion project
    const bundleLocation = await bundle({
      entryPoint: path.resolve(__dirname, 'index.js'),
      webpackOverride: (config) => config,
    });

    // 4. Prepare input props
    const inputProps = {
      videoData: {
        title,
        content,
        imageUrls,
        audioPath,
        volume,
        image_display_time: imageDisplayTime,
        transition_duration: transitionDuration,
        zoom_intensity: zoomIntensity
      }
    };

    // 5. Select composition
    const composition = await selectComposition({
      serveUrl: bundleLocation,
      id: 'BackgroundVideo',
      inputProps
    });

    // 6. Render video with proper duration
    await renderMedia({
      composition,
      serveUrl: bundleLocation,
      codec: 'h264',
      outputLocation: outputPath,
      inputProps,
      durationInFrames,
      chromiumOptions: {
        disableWebSecurity: true,
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      },
      onProgress: ({ progress }) => {
        console.log(`Rendering progress: ${(progress * 100).toFixed(1)}%`);
      }
    });

    return outputPath;
  } catch (error) {
    console.error('Video rendering failed:', error);
    throw error;
  }
}

module.exports = { renderVideo };