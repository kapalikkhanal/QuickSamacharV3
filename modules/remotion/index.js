// server/modules/remotion/index.js
import { registerRoot, Composition, continueRender, delayRender, getInputProps } from 'remotion';
import { VideoBackground } from './video';
import React, { useEffect, useState } from 'react';

const RemotionVideo = () => {
  const { videoData } = getInputProps();
  const fps = 30;
  
  const [handle] = useState(() => delayRender("Waiting for audio duration"));
  const [durationInFrames, setDurationInFrames] = useState(fps * 10); // Default 10 seconds

  useEffect(() => {
    const calculateDuration = async () => {
      try {
        const audio = new Audio(`/public${videoData.audioPath}`);
        
        const duration = await new Promise((resolve) => {
          audio.addEventListener('loadedmetadata', () => {
            resolve(audio.duration);
          });
          
          audio.addEventListener('error', () => {
            resolve(10); // Fallback duration
          });

          setTimeout(() => resolve(10), 5000); // Timeout fallback
        });

        setDurationInFrames(Math.ceil(duration * fps));
        continueRender(handle);
      } catch (error) {
        console.error('Duration calculation error:', error);
        setDurationInFrames(fps * 10);
        continueRender(handle);
      }
    };

    calculateDuration();
  }, [videoData?.audioPath]);

  return (
    <Composition
      id="BackgroundVideo"
      component={VideoBackground}
      width={1080}
      height={1920}
      fps={fps}
      durationInFrames={durationInFrames}
      defaultProps={{ videoData }}
    />
  );
};

registerRoot(RemotionVideo);