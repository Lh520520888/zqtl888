// MatchPulse - 赛事数据引擎 Offscreen 音频播放器
// 用于在后台播放提示音（TTS 文字转语音）

let stopTimeout = null;
let currentAudio = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PLAY_AUDIO_OFFSCREEN') {
    const { team, eventType, soundType, duration, customSound } = message.data;
    if (customSound && customSound.data) {
      playCustomSound(customSound.data, duration, eventType, team);
    } else {
      const text = getTTSText(eventType, team);
      playTTS(text, duration);
    }
    sendResponse({ status: 'playing' });
  }
  return true;
});

function getTTSText(eventType, team) {
  if (eventType === 'startAlert') return '开始警示';
  if (eventType === 'neutralCorner') return '中立角球';
  if (eventType === 'supplement') return '速度补单';
  const teamText = team === 'home' ? '主' : '客';
  const eventText = eventType === 'corner' ? '角球' : '危险任意球';
  return teamText + eventText;
}

function playCustomSound(dataUrl, duration, fallbackType, fallbackTeam) {
  stopCurrentSound();

  currentAudio = new Audio(dataUrl);
  currentAudio.loop = true;
  currentAudio.volume = 0.8;
  currentAudio.play().catch(err => {
    console.error('[MatchPulse] 播放自定义音频失败:', err);
    currentAudio = null;
    const text = getTTSText(fallbackType, fallbackTeam);
    playTTS(text, duration);
  });

  console.log('[MatchPulse] 播放自定义提示音');

  stopTimeout = setTimeout(() => {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }
    console.log('[MatchPulse] 自定义提示音播放完成');
  }, duration);
}

function stopCurrentSound() {
  if (stopTimeout) {
    clearTimeout(stopTimeout);
    stopTimeout = null;
  }
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
}

function playTTS(text, duration) {
  stopCurrentSound();

  if (!window.speechSynthesis) {
    console.log('[MatchPulse] 浏览器不支持TTS');
    return;
  }

  window.speechSynthesis.cancel();

  let stopped = false;
  const startTime = Date.now();

  const speak = () => {
    if (stopped) return;
    if (Date.now() - startTime >= duration) return;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = 1.2;
    utterance.pitch = 1.4;
    utterance.volume = 1.0;

    const voices = window.speechSynthesis.getVoices();
    const femaleVoice = voices.find(v =>
      v.lang.includes('zh') && (
        v.name.includes('Female') || v.name.includes('female') ||
        v.name.includes('Xiaoxiao') || v.name.includes('Huihui') ||
        v.name.includes('Yunjian') || v.name.includes('MeiJia') ||
        v.name.includes('Yaoyao')
      )
    );
    if (femaleVoice) {
      utterance.voice = femaleVoice;
    }

    utterance.onstart = () => {
      console.log('[MatchPulse] 播放TTS:', text);
    };

    utterance.onend = () => {
      if (!stopped && Date.now() - startTime < duration) {
        speak();
      }
    };

    utterance.onerror = () => {
      if (!stopped && Date.now() - startTime < duration) {
        setTimeout(speak, 200);
      }
    };

    window.speechSynthesis.speak(utterance);
  };

  const voices = window.speechSynthesis.getVoices();
  if (voices.length > 0) {
    speak();
  } else {
    window.speechSynthesis.onvoiceschanged = () => {
      window.speechSynthesis.onvoiceschanged = null;
      speak();
    };
    setTimeout(() => {
      window.speechSynthesis.onvoiceschanged = null;
      speak();
    }, 1000);
  }

  stopTimeout = setTimeout(() => {
    stopped = true;
    window.speechSynthesis.cancel();
    console.log('[MatchPulse] TTS播放超时停止');
  }, duration);
}