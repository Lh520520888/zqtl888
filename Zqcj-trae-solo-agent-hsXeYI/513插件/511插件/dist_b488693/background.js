// MatchPulse - 赛事数据引擎 后台服务
// 消息路由、信号日志存储、提示音播放

// 日志存储 - 按 matchId 隔离
// 结构: { matchId: [logEntry, ...] }
let eventLogsByMatch = {};
let debugLogs = [];
const MAX_LOGS_PER_MATCH = 200;
const MAX_DEBUG_LOGS = 100;

// 下注记录存储 - 按 matchId 隔离
// 结构: { matchId: [record, ...] }
let betRecordsByMatch = {};
const MAX_BET_RECORDS_PER_MATCH = 100;

// 待补单状态
let pendingSupplement = null;

// 队伍名称 - 按 matchId 隔离
// 结构: { matchId: { home: '主队名', away: '客队名' } }
let teamNamesByMatch = {};

// 跨脚本去重：记录各球队最近一次实际触发提醒的时间
// 结构: { matchId: { key: timestamp } }
// key: `${eventType}-${teamName}`, value: timestamp
const alertDedupByMatch = {};
let dedupWindowMs = 15000; // 默认15秒去重窗口，可通过设置修改

function safeSendMessage(msg, callback) {
  try {
    if (callback) {
      chrome.runtime.sendMessage(msg, callback);
    } else {
      chrome.runtime.sendMessage(msg);
    }
  } catch (e) {
    if (e.message && e.message.includes('Extension context invalidated')) {
      console.warn('[MatchPulse] 扩展上下文已失效，跳过消息:', msg.type);
    } else {
      console.warn('[MatchPulse] 发送消息失败:', msg.type, e);
    }
  }
}

// 定时验证账户状态
const CHECK_INTERVAL = 60 * 60 * 1000; // 每小时检查一次
async function checkAccountStatus() {
  try {
    const token = await new Promise((resolve) => {
      chrome.storage.local.get(['auth_token'], (result) => resolve(result.auth_token));
    });

    if (!token) return;

    const deviceId = await new Promise((resolve) => {
      chrome.storage.local.get(['device_id'], (result) => resolve(result.device_id));
    });

    const response = await fetch('http://103.146.231.236:8080/api/v1/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ device_id: deviceId })
    });

    const data = await response.json();

    if (!data.success) {
      let errorMessage = '账户验证失败';
      if (response.status === 403) {
        if (data.code === 'DEVICE_REMOVED') {
          errorMessage = '设备数量超限，您的账号已在其他设备登录，当前设备已被移除';
        } else if (data.message === '账户已过期') {
          errorMessage = '账户已过期，请联系管理员';
        } else {
          errorMessage = data.message || '账户已被禁用';
        }
      } else if (response.status === 401) {
        errorMessage = '登录已过期，请重新登录';
      }

      console.log('[MatchPulse] 账户验证失败:', errorMessage);
      await chrome.storage.local.remove(['auth_token', 'auth_user']);
      showNotification('登录状态失效', errorMessage);
    }
  } catch (error) {
    console.error('[MatchPulse] 账户状态检查失败:', error);
  }
}

// 启动定时验证
setInterval(checkAccountStatus, CHECK_INTERVAL);
// 延迟首次检查，避免启动时就检查
setTimeout(checkAccountStatus, 30000);

// 初始化 - 从存储加载日志和设置
chrome.storage.local.get(['eventLogsByMatch', 'betRecordsByMatch', 'eventLogs', 'betRecords', 'dedupWindowSec', 'pendingSupplement'], (result) => {
  // 新格式数据
  if (result.eventLogsByMatch) {
    eventLogsByMatch = result.eventLogsByMatch;
  }
  if (result.betRecordsByMatch) {
    betRecordsByMatch = result.betRecordsByMatch;
  }
  
  // 迁移旧格式数据（如果存在）
  if (result.eventLogs && !result.eventLogsByMatch) {
    console.log('[MatchPulse] 迁移旧格式事件日志...');
    result.eventLogs.forEach(log => {
      const matchId = log.matchId || 'unknown';
      if (!eventLogsByMatch[matchId]) {
        eventLogsByMatch[matchId] = [];
      }
      eventLogsByMatch[matchId].push(log);
    });
    // 清除旧数据
    chrome.storage.local.remove('eventLogs');
    saveLogs();
    console.log('[MatchPulse] 事件日志迁移完成');
  }
  
  if (result.betRecords && !result.betRecordsByMatch) {
    console.log('[MatchPulse] 迁移旧格式下注记录...');
    result.betRecords.forEach(record => {
      const matchId = record.matchId || 'unknown';
      if (!betRecordsByMatch[matchId]) {
        betRecordsByMatch[matchId] = [];
      }
      betRecordsByMatch[matchId].push(record);
    });
    // 清除旧数据
    chrome.storage.local.remove('betRecords');
    saveBetRecords();
    console.log('[MatchPulse] 下注记录迁移完成');
  }
  
  if (result.pendingSupplement) {
    pendingSupplement = result.pendingSupplement;
  }
  if (result.dedupWindowSec != null) {
    dedupWindowMs = (parseInt(result.dedupWindowSec) || 15) * 1000;
  }
  console.log('[MatchPulse] Background服务已启动，去重窗口=' + dedupWindowMs / 1000 + 's');
});

// 预创建 offscreen document，消除首次播放延迟
setTimeout(() => {
  createOffscreenDocument().then(() => {
    console.log('[MatchPulse] Offscreen document 已预创建');
  });
}, 1000);

// 监听设置变化，实时更新去重窗口
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.dedupWindowSec) {
    dedupWindowMs = (parseInt(changes.dedupWindowSec.newValue) || 15) * 1000;
    console.log('[MatchPulse] 去重窗口已更新=' + dedupWindowMs / 1000 + 's');
  }
});

// 保存日志到存储
function saveLogs() {
  chrome.storage.local.set({ eventLogsByMatch: eventLogsByMatch });
}

// 添加日志
function addLog(logData) {
  const matchId = logData.matchId || 'default';
  if (!eventLogsByMatch[matchId]) {
    eventLogsByMatch[matchId] = [];
  }
  const logEntry = { id: Date.now(), ...logData };
  eventLogsByMatch[matchId].push(logEntry);
  
  // 限制每个比赛的日志数量
  if (eventLogsByMatch[matchId].length > MAX_LOGS_PER_MATCH) {
    eventLogsByMatch[matchId] = eventLogsByMatch[matchId].slice(-MAX_LOGS_PER_MATCH);
  }
  saveLogs();
  return logEntry;
}

// 添加调试日志
function addDebugLog(data) {
  debugLogs.push(data);
  if (debugLogs.length > MAX_DEBUG_LOGS) {
    debugLogs = debugLogs.slice(-MAX_DEBUG_LOGS);
  }
}

// 获取指定比赛的日志
function getLogs(matchId) {
  if (matchId) {
    return eventLogsByMatch[matchId] || [];
  }
  // 如果没有指定 matchId，返回所有日志
  let allLogs = [];
  Object.values(eventLogsByMatch).forEach(logs => {
    allLogs = allLogs.concat(logs);
  });
  return allLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

// 获取所有比赛的日志映射
function getLogsByMatch() {
  return eventLogsByMatch;
}

// 获取调试日志
function getDebugLogs() {
  return debugLogs;
}

// 清除指定比赛的日志
function clearLogs(matchId) {
  if (matchId) {
    delete eventLogsByMatch[matchId];
  } else {
    eventLogsByMatch = {};
  }
  saveLogs();
}

// 清除调试日志
function clearDebugLogs() {
  debugLogs = [];
}

// ===== 下注/补单 数据管理 =====

function saveBetRecords() {
  chrome.storage.local.set({ betRecordsByMatch: betRecordsByMatch });
}

function addBetRecord(record) {
  const matchId = record.matchId || 'default';
  if (!betRecordsByMatch[matchId]) {
    betRecordsByMatch[matchId] = [];
  }
  const entry = { id: Date.now(), ...record };
  betRecordsByMatch[matchId].push(entry);
  
  // 限制每个比赛的下注记录数量
  if (betRecordsByMatch[matchId].length > MAX_BET_RECORDS_PER_MATCH) {
    betRecordsByMatch[matchId] = betRecordsByMatch[matchId].slice(-MAX_BET_RECORDS_PER_MATCH);
  }
  saveBetRecords();
  return entry;
}

function getBetRecords(matchId) {
  if (matchId) {
    return betRecordsByMatch[matchId] || [];
  }
  // 如果没有指定 matchId，返回所有记录
  let allRecords = [];
  Object.values(betRecordsByMatch).forEach(records => {
    allRecords = allRecords.concat(records);
  });
  return allRecords.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

function getBetRecordsByMatch() {
  return betRecordsByMatch;
}

function clearBetRecords(matchId) {
  if (matchId) {
    delete betRecordsByMatch[matchId];
  } else {
    betRecordsByMatch = {};
  }
  saveBetRecords();
}

function savePendingSupplement() {
  chrome.storage.local.set({ pendingSupplement: pendingSupplement });
}

function setPendingSupplement(data) {
  pendingSupplement = { ...data, timestamp: new Date().toISOString() };
  savePendingSupplement();
}

function clearPendingSupplement() {
  pendingSupplement = null;
  chrome.storage.local.remove('pendingSupplement');
}

function getPendingSupplement() {
  return pendingSupplement;
}

// 播放提示音
async function playSound(team, eventType) {
  try {
    await createOffscreenDocument();

    let soundType, storageKey;

    if (eventType === 'startAlert') {
      // 开始警示声音
      soundType = 'startAlert';
      storageKey = 'custom_startAlert';
    } else if (eventType === 'neutralCorner') {
      // 中立角球声音
      soundType = 'neutralCorner';
      storageKey = 'custom_neutralCorner';
    } else if (eventType === 'supplement') {
      // 补单提醒声音
      soundType = 'supplement';
      storageKey = 'custom_supplement';
    } else {
      // 角球和危险任意球声音
      soundType = team + (eventType === 'corner' ? 'Corner' : 'Freekick');
      storageKey = 'custom_' + soundType;
    }

    const result = await chrome.storage.local.get([storageKey]);
    const customSound = result[storageKey];

    safeSendMessage({
      type: 'PLAY_AUDIO_OFFSCREEN',
      data: {
        team: team,
        eventType: eventType,
        soundType: soundType,
        duration: 5000,
        customSound: customSound || null
      }
    });

    if (eventType === 'startAlert') {
      console.log(`[MatchPulse] 播放开始警示声音${customSound ? '(自定义)' : '(默认)'}`);
    } else if (eventType === 'neutralCorner') {
      console.log(`[MatchPulse] 播放提示音: 中立角球${customSound ? '(自定义)' : '(默认)'}`);
    } else if (eventType === 'supplement') {
      console.log(`[MatchPulse] 播放补单提示音${customSound ? '(自定义)' : '(默认)'}`);
    } else {
      const teamText = team === 'home' ? '主' : '客';
      const eventText = eventType === 'corner' ? '角球' : '危险任意球';
      console.log(`[MatchPulse] 播放提示音: ${teamText}${eventText}${customSound ? '(自定义)' : '(默认)'}`);
    }
  } catch (error) {
    console.error('[MatchPulse] 播放提示音失败:', error);
    showNotification(team, eventType);
  }
}

// 创建 offscreen document
let creating = null;
async function createOffscreenDocument() {
  const offscreenUrl = 'offscreen.html';
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(offscreenUrl)]
  });

  if (existingContexts.length > 0) return;

  if (creating) {
    await creating;
  } else {
    creating = chrome.offscreen.createDocument({
      url: offscreenUrl,
      reasons: ['AUDIO_PLAYBACK'],
      justification: '播放比赛事件提示音'
    });
    await creating;
    creating = null;
  }
}

// 显示通知（备用方案）
function showNotification(team, eventType) {
  const teamText = team === 'home' ? '主队' : '客队';
  const eventText = eventType === 'corner' ? '角球' : '危险任意球';
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'MatchPulse 赛事信号',
    message: `${teamText}获得${eventText}！`,
    priority: 2
  });
}

// 消息监听
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'DETECTION_LOG': {
      // 检测到事件但不在时间窗口内，只记录日志不报警
      const d = message.data;
      addLog({
        matchId: d.matchId || 'unknown',
        eventType: d.eventType,
        team: d.team,
        teamName: d.teamName,
        minute: d.minute,
        source: d.source,
        isAlert: false,
        skipReason: '时间窗口外',
        timestamp: new Date().toISOString(),
        url: d.url || ''
      });
      sendResponse({ status: 'ok' });
      break;
    }

    case 'CONTENT_LOADED':
      sendResponse({ status: 'ok' });
      break;

    case 'LOG':
      const logEntry = addLog(message.data);
      sendResponse({ status: 'ok', log: logEntry });
      break;

    case 'DEBUG_LOG':
      addDebugLog(message.data);
      sendResponse({ status: 'ok' });
      break;

    case 'ALERT_REQUEST': {
      // 统一去重入口：来自 iframe 动画 或 主页面文字解说 都走这里
      const { team, eventType, teamName, minute, source, matchId } = message.data;
      
      // 使用 matchId 隔离去重，如果没有 matchId 则使用 'default'
      const effectiveMatchId = matchId || 'default';
      
      // 确保该比赛的去重映射存在
      if (!alertDedupByMatch[effectiveMatchId]) {
        alertDedupByMatch[effectiveMatchId] = {};
      }
      const alertDedup = alertDedupByMatch[effectiveMatchId];
      
      const dedupKey = `${eventType}-${teamName}`;
      const now = Date.now();
      const lastTime = alertDedup[dedupKey] || 0;
      const elapsed = now - lastTime;

      addDebugLog({
        time: new Date().toLocaleTimeString('zh-CN'),
        message: `[去重] 比赛ID=${effectiveMatchId} 来源=${source} key=${dedupKey} 距上次=${Math.round(elapsed/1000)}s`
      });
      console.log(`[MatchPulse] ALERT_REQUEST 比赛ID=${effectiveMatchId} 来源=${source} key=${dedupKey} 距上次=${Math.round(elapsed/1000)}s`);

      if (elapsed < dedupWindowMs) {
        // 去重窗口内已响过，写日志标记为未报警
        addLog({
          matchId: effectiveMatchId,
          eventType,
          team,
          teamName,
          minute,
          source,
          isAlert: false,
          skipReason: '去重',
          timestamp: new Date().toISOString(),
          url: message.data.url || ''
        });
        addDebugLog({
          time: new Date().toLocaleTimeString('zh-CN'),
          message: `[去重] ⛔ 丢弃重复提醒: ${dedupKey} (比赛=${effectiveMatchId}, 来源=${source})`
        });
        console.log(`[MatchPulse] ⛔ 丢弃重复提醒: ${dedupKey} 比赛=${effectiveMatchId} 来源=${source}`);
        sendResponse({ status: 'dedup', reason: '去重窗口内已提醒' });
        break;
      }

      // 通过去重，记录时间并执行
      alertDedup[dedupKey] = now;
      addDebugLog({
        time: new Date().toLocaleTimeString('zh-CN'),
        message: `[去重] ✅ 允许提醒: ${dedupKey} (比赛=${effectiveMatchId}, 来源=${source})`
      });
      console.log(`[MatchPulse] ✅ 允许提醒: ${dedupKey} 比赛=${effectiveMatchId} 来源=${source}`);

      // 记录日志（isAlert: true）
      addLog({
        matchId: effectiveMatchId,
        eventType,
        team,
        teamName,
        minute,
        source,
        isAlert: true,
        timestamp: new Date().toISOString(),
        url: message.data.url || ''
      });

      // 播放声音
      playSound(team, eventType);
      sendResponse({ status: 'ok' });
      break;
    }

    case 'PLAY_SOUND':
      playSound(message.data.team, message.data.eventType);
      sendResponse({ status: 'ok' });
      break;

    case 'GET_LOGS':
      sendResponse({ 
        logs: getLogs(message.data?.matchId),
        logsByMatch: getLogsByMatch()
      });
      break;

    case 'GET_DEBUG_LOGS':
      sendResponse({ logs: getDebugLogs() });
      break;

    case 'CLEAR_LOGS':
      clearLogs(message.data?.matchId);
      sendResponse({ status: 'ok' });
      break;

    case 'CLEAR_DEBUG_LOGS':
      clearDebugLogs();
      sendResponse({ status: 'ok' });
      break;

    case 'BET_RECORD':
      addBetRecord(message.data);
      sendResponse({ status: 'ok' });
      break;

    case 'SET_PENDING_SUPPLEMENT':
      setPendingSupplement(message.data);
      sendResponse({ status: 'ok' });
      break;

    case 'CLEAR_PENDING_SUPPLEMENT':
      clearPendingSupplement();
      sendResponse({ status: 'ok' });
      break;

    case 'GET_BET_RECORDS':
      sendResponse({ 
        records: getBetRecords(message.data?.matchId),
        recordsByMatch: getBetRecordsByMatch()
      });
      break;

    case 'CLEAR_BET_RECORDS':
      clearBetRecords(message.data?.matchId);
      sendResponse({ status: 'ok' });
      break;

    case 'SET_TEAM_NAMES':
      if (message.data && message.data.home && message.data.away && message.data.matchId) {
        teamNamesByMatch[message.data.matchId] = { 
          home: message.data.home, 
          away: message.data.away 
        };
        console.log(`[MatchPulse] 设置队伍名称: 比赛=${message.data.matchId} 主=${message.data.home} 客=${message.data.away}`);
      }
      sendResponse({ status: 'ok' });
      break;

    case 'GET_TEAM_NAMES':
      // 需要传入 matchId 来获取对应比赛的队伍名称
      const queryMatchId = message.data?.matchId;
      if (queryMatchId && teamNamesByMatch[queryMatchId]) {
        sendResponse({ teamNames: teamNamesByMatch[queryMatchId], matchId: queryMatchId });
      } else {
        // 返回所有比赛的队伍名称（用于 popup 显示）
        sendResponse({ teamNamesByMatch: teamNamesByMatch });
      }
      break;

    default:
      break;
  }

  return true;
});

// 安装/更新时的处理
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.local.set({
      eventLogs: [],
      settings: { soundEnabled: true, notificationEnabled: true }
    });
  }
});
