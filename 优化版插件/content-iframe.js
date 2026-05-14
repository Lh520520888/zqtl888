// MatchPulse - 赛事数据引擎 动画信号采集模块 (性能优化版)
// 优化内容：降低扫描频率、优化DOM查询、减少重复计算

(function() {
  'use strict';

  const CONFIG = {
    CHECK_INTERVAL: 1200,        // 从 500ms 增加到 1200ms，大幅降低CPU占用
    OBSERVER_THROTTLE: 500,      // 从 200ms 增加到 500ms
  };

  const STORAGE_KEY = 'mp_iframe_events';
  const BET_RECORDS_KEY = 'mp_bet_records';
  const PENDING_SUPPLEMENT_KEY = 'mp_pending_supplement';
  
  // 缓存常用DOM元素
  let cachedTeamElements = { home: null, away: null };
  let lastTeamCheckTime = 0;
  const TEAM_CACHE_DURATION = 3000; // 球队名称缓存3秒

  // 开始警示状态 key - 按 matchId 隔离
  const getStartAlertKey = () => `mp_start_alert_${getMatchId() || 'default'}`;
  
  // 已记录事件 key - 按 matchId 隔离
  const getRecordedEventsKey = () => `mp_iframe_events_${getMatchId() || 'default'}`;

  // 时间设置
  let timeSettings = {
    firstHalfStart: 32,
    firstHalfEnd: 44,
    secondHalfStart: 78,
    secondHalfEnd: 88
  };
  // 记录是否已触发开始警示
  let startAlertTriggered = {
    firstHalf: false,
    secondHalf: false
  };

  // 加载时间设置
  function loadTimeSettings() {
    chrome.storage.local.get(['firstHalfStart', 'firstHalfEnd', 'secondHalfStart', 'secondHalfEnd', 'dedupWindowSec'], (result) => {
      timeSettings.firstHalfStart = result.firstHalfStart ?? 32;
      timeSettings.firstHalfEnd = result.firstHalfEnd ?? 44;
      timeSettings.secondHalfStart = result.secondHalfStart ?? 78;
      timeSettings.secondHalfEnd = result.secondHalfEnd ?? 88;
      dedupWindowMs = (parseInt(result.dedupWindowSec) || 15) * 1000;
      sendDebugLog(`时间设置已加载: 上半场=${timeSettings.firstHalfStart}-${timeSettings.firstHalfEnd}分, 下半场=${timeSettings.secondHalfStart}-${timeSettings.secondHalfEnd}分, 冷却=${dedupWindowMs/1000}s`);
    });
  }

  // 加载开始警示状态
  function loadStartAlertState() {
    try {
      const key = getStartAlertKey();
      const data = localStorage.getItem(key);
      if (data) {
        const state = JSON.parse(data);
        startAlertTriggered = state;
      }
    } catch (e) {}
  }

  // 保存开始警示状态
  function saveStartAlertState() {
    try {
      const key = getStartAlertKey();
      localStorage.setItem(key, JSON.stringify(startAlertTriggered));
    } catch (e) {}
  }

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

  // 判断当前是上半场还是下半场
  function getMatchHalf(minute) {
    const min = parseInt(minute) || 0;
    if (min <= 45) return 'first';
    return 'second';
  }

  // 检查是否应该提醒（在时间范围内）
  function shouldAlert(minute) {
    const min = parseInt(minute) || 0;
    const half = getMatchHalf(minute);

    if (half === 'first') {
      return min >= timeSettings.firstHalfStart && min <= timeSettings.firstHalfEnd;
    } else {
      return min >= timeSettings.secondHalfStart && min <= timeSettings.secondHalfEnd;
    }
  }

  // 显示开始警示
  function showStartAlert(half) {
    const halfText = half === 'first' ? '上半场' : '下半场';
    const startTime = half === 'first' ? timeSettings.firstHalfStart : timeSettings.secondHalfStart;
    const endTime = half === 'first' ? timeSettings.firstHalfEnd : timeSettings.secondHalfEnd;

    const existingAlert = document.getElementById('mp-visual-alert');
    if (existingAlert) {
      existingAlert.remove();
    }

    const alertDiv = document.createElement('div');
    alertDiv.id = 'mp-visual-alert';
    alertDiv.innerHTML = `
      <div style="
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 999999;
        background: #ff0000;
        color: white;
        padding: 15px 20px;
        font-size: 18px;
        font-weight: bold;
        text-align: center;
        box-shadow: 0 4px 20px rgba(0,0,0,0.4);
        animation: alertPulse 0.5s ease-in-out 3;
        font-family: -apple-system, BlinkMacSystemFont, 'Microsoft YaHei', sans-serif;
      ">
        <div style="font-size: 24px; margin-bottom: 5px;">
          🔔 开始警示 🔔
        </div>
        <div>
          ${halfText} ${startTime}'-${endTime}' - 提醒已开启
        </div>
      </div>
      <style>
        @keyframes alertPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.8; transform: scale(1.02); }
        }
      </style>
    `;

    document.body.appendChild(alertDiv);

    safeSendMessage({
      type: 'PLAY_SOUND',
      data: { team: 'home', eventType: 'startAlert' }
    });

    setTimeout(() => {
      if (alertDiv && alertDiv.parentNode) {
        alertDiv.style.transition = 'opacity 0.5s';
        alertDiv.style.opacity = '0';
        setTimeout(() => alertDiv.remove(), 500);
      }
    }, 5000);

    sendDebugLog(`★★★ ${halfText}开始警示已触发 (${startTime}'-${endTime}')`);
  }

  // 检查是否需要触发开始警示
  function checkStartAlert() {
    const minute = getCurrentMinute();
    const min = parseInt(minute) || 0;
    const half = getMatchHalf(minute);

    if (half === 'first' && !startAlertTriggered.firstHalf) {
      if (min >= timeSettings.firstHalfStart && timeSettings.firstHalfStart > 0) {
        startAlertTriggered.firstHalf = true;
        saveStartAlertState();
        showStartAlert('first');
      }
    } else if (half === 'second' && !startAlertTriggered.secondHalf) {
      if (min >= timeSettings.secondHalfStart && timeSettings.secondHalfStart > 45) {
        startAlertTriggered.secondHalf = true;
        saveStartAlertState();
        showStartAlert('second');
      }
    }
  }

  function getRecordedEvents() {
    try {
      const key = getRecordedEventsKey();
      const data = localStorage.getItem(key);
      if (data) {
        return new Set(JSON.parse(data));
      }
    } catch (e) {}
    return new Set();
  }

  function saveRecordedEvents(events) {
    try {
      const key = getRecordedEventsKey();
      localStorage.setItem(key, JSON.stringify(Array.from(events)));
    } catch (e) {}
  }

  let recordedEvents = new Set();

  let cachedPendingSupplement = null;

  function getBetRecords() {
    try {
      const data = localStorage.getItem(BET_RECORDS_KEY);
      if (data) return JSON.parse(data);
    } catch (e) {}
    return [];
  }

  function saveBetRecords(records) {
    try {
      localStorage.setItem(BET_RECORDS_KEY, JSON.stringify(records));
    } catch (e) {}
  }

  function addBetRecord(record) {
    const records = getBetRecords();
    const entry = { id: Date.now(), ...record };
    records.push(entry);
    saveBetRecords(records);
    return entry;
  }

  function getPendingSupplement() {
    return cachedPendingSupplement;
  }

  function setPendingSupplement(data) {
    cachedPendingSupplement = data;
    try {
      localStorage.setItem(PENDING_SUPPLEMENT_KEY, JSON.stringify(data));
    } catch (e) {}
  }

  function clearPendingSupplement() {
    cachedPendingSupplement = null;
    try {
      localStorage.removeItem(PENDING_SUPPLEMENT_KEY);
    } catch (e) {}
  }

  function syncPendingSupplementFromStorage() {
    chrome.storage.local.get(['pendingSupplement'], (result) => {
      if (result.pendingSupplement) {
        if (!cachedPendingSupplement || result.pendingSupplement.betTimestamp > (cachedPendingSupplement.betTimestamp || '')) {
          cachedPendingSupplement = result.pendingSupplement;
          try {
            localStorage.setItem(PENDING_SUPPLEMENT_KEY, JSON.stringify(result.pendingSupplement));
          } catch (e) {}
          sendDebugLog(`[补单同步] 从chrome.storage同步待补单: ${result.pendingSupplement.betTeamName} vs ${result.pendingSupplement.oppositeTeamName}`);
        }
      } else if (!cachedPendingSupplement) {
        cachedPendingSupplement = null;
      }
    });
  }

  function showSupplementAlert(teamName, eventType, minute, team, betInfo) {
    const existingAlert = document.getElementById('mp-visual-alert');
    if (existingAlert) existingAlert.remove();
    const existingOverlay = document.getElementById('mp-alert-overlay');
    if (existingOverlay) existingOverlay.remove();
    const existingSupplement = document.getElementById('mp-supplement-alert');
    if (existingSupplement) existingSupplement.remove();

    const eventText = eventType === 'attack' ? '进攻' : eventType === 'possession' ? '持续控球' : '危险进攻';
    const accentColor = '#ffab00';
    const accentGlow = 'rgba(255,171,0,0.4)';
    const isHome = team === 'home';
    const betSide = betInfo.betTeam === 'home' ? '主队' : '客队';
    const position = isHome ? 'left: 16px; transform: translateY(-50%) scale(0.8);' : 'right: 16px; transform: translateY(-50%) scale(0.8);';
    const activePosition = isHome ? 'left: 16px; transform: translateY(-50%) scale(1);' : 'right: 16px; transform: translateY(-50%) scale(1);';

    const overlay = document.createElement('div');
    overlay.id = 'mp-alert-overlay';
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: transparent; z-index: 9999998; opacity: 0;
      pointer-events: none; transition: opacity 0.3s ease;
    `;
    document.body.appendChild(overlay);

    const alertDiv = document.createElement('div');
    alertDiv.id = 'mp-supplement-alert';
    alertDiv.style.cssText = `
      position: fixed; top: 50%; ${position}
      z-index: 9999999;
      background: rgba(10,15,30,0.96);
      color: #e0e6f0; padding: 0; border-radius: 12px;
      box-shadow: 0 0 40px ${accentGlow}, 0 8px 32px rgba(0,0,0,0.6);
      text-align: center;
      transition: all 0.35s cubic-bezier(0.34,1.56,0.64,1);
      border-left: 3px solid ${accentColor};
      overflow: hidden; min-width: 240px;
    `;

    alertDiv.innerHTML = `
      <div style="background:${accentColor};padding:10px 16px;display:flex;align-items:center;justify-content:center;gap:8px;">
        <span style="font-size:16px;">↻</span>
        <span style="font-size:15px;font-weight:700;color:#fff;letter-spacing:1px;">对冲信号</span>
      </div>
      <div style="padding:14px 16px 12px;">
        <div style="font-size:13px;color:#8899aa;margin-bottom:4px;">${minute}' · ${teamName} ${isHome ? '(主)' : '(客)'} ${eventText}</div>
        <div style="font-size:11px;color:#667788;margin-bottom:10px;">此前 ${betSide} 已标记，对方进攻建议对冲</div>
        <div style="display:flex;gap:8px;justify-content:center;">
          <button id="mp-supplement-btn" style="background:${accentColor};color:#fff;
            border: none; padding: 7px 18px; font-size: 12px; font-weight: 600;
            border-radius: 6px; cursor: pointer; letter-spacing:0.5px;">
            标记对冲
          </button>
          <button id="mp-close-supplement" style="background:rgba(255,255,255,0.06);color:#8899aa;
            border: 1px solid rgba(255,255,255,0.08); padding: 7px 14px; font-size: 12px;
            font-weight: 500; border-radius: 6px; cursor: pointer;">
            忽略
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(alertDiv);

    setTimeout(() => {
      alertDiv.style.cssText = `
        position: fixed; top: 50%; ${activePosition}
        z-index: 9999999;
        background: rgba(10,15,30,0.96);
        color: #e0e6f0; padding: 0; border-radius: 12px;
        box-shadow: 0 0 40px ${accentGlow}, 0 8px 32px rgba(0,0,0,0.6);
        text-align: center;
        transition: all 0.35s cubic-bezier(0.34,1.56,0.64,1);
        border-left: 3px solid ${accentColor};
        overflow: hidden; min-width: 240px;
      `;
    }, 10);

    document.getElementById('mp-supplement-btn').addEventListener('click', () => {
      const record = {
        type: 'supplement',
        matchId: getMatchId(),
        team: team,
        eventType: eventType,
        teamName: teamName,
        minute: minute,
        timestamp: new Date().toISOString(),
        url: window.location.href,
        relatedBetId: betInfo.betId
      };
      addBetRecord(record);
      safeSendMessage({ type: 'BET_RECORD', data: record });
      sendDebugLog(`[${getMatchTime()}] ✅ 用户已补单: ${teamName} ${eventText}`);
      supplementAlertShown = false;
      alertDiv.style.opacity = '0';
      alertDiv.style.transform = alertDiv.style.transform.replace('scale(1)', 'scale(0.9)');
      setTimeout(() => {
        alertDiv.remove();
        overlay.remove();
      }, 250);
      clearPendingSupplement();
      safeSendMessage({ type: 'CLEAR_PENDING_SUPPLEMENT' });
    });

    const closeBtn = document.getElementById('mp-close-supplement');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        supplementAlertShown = false;
        alertDiv.style.opacity = '0';
        alertDiv.style.transform = alertDiv.style.transform.replace('scale(1)', 'scale(0.9)');
        setTimeout(() => {
          alertDiv.remove();
          overlay.remove();
        }, 250);
      });
    }

    setTimeout(() => {
      if (alertDiv && alertDiv.parentNode) {
        supplementAlertShown = false;
        alertDiv.style.opacity = '0';
        alertDiv.style.transform = alertDiv.style.transform.replace('scale(1)', 'scale(0.9)');
        setTimeout(() => {
          alertDiv.remove();
          overlay.remove();
        }, 250);
      }
    }, 30000);

    safeSendMessage({
      type: 'PLAY_SOUND',
      data: { team: 'supplement', eventType: 'supplement' }
    });
  }

  function processAttackEvent(labelElement, eventType, teams, detectedTeamName) {
    Object.keys(possessionTimers).forEach(tn => clearPossessionTimer(tn));
    
    let teamName = detectedTeamName;
    let team = 'home';

    const popModel = labelElement.closest('.pop-model') || labelElement.closest('[class*="pop"]');
    if (popModel) {
      const classList = popModel.className || '';
      if (classList.includes('away')) team = 'away';
      else if (classList.includes('home')) team = 'home';
    }

    if (teamName && teamName !== '未知') {
      if (teamName === teams.away) team = 'away';
      else if (teamName === teams.home) team = 'home';
    }

    if (!teamName || teamName === '未知') {
      teamName = team === 'home' ? teams.home : teams.away;
    }

    const minute = getCurrentMinute();
    const eventId = `attack-${eventType}-${teamName}-${minute}`;

    if (sentEventIds.has(eventId)) {
      return;
    }
    sentEventIds.add(eventId);
    setTimeout(() => sentEventIds.delete(eventId), 30000);

    const eventText = eventType === 'attack' ? '进攻' : '危险进攻';
    sendDebugLog(`[${getMatchTime()}] >>> 检测到${eventText}: ${teamName}(${team})`);

    const attackCooldownKey = `${eventType}-${teamName}`;
    const attackCooldownUntil = cooldownMap[attackCooldownKey] || 0;
    if (Date.now() < attackCooldownUntil) {
      sendDebugLog(`[${getMatchTime()}] 进攻冷却中: ${attackCooldownKey} 剩余${Math.round((attackCooldownUntil - Date.now()) / 1000)}s`);
      return;
    }
    cooldownMap[attackCooldownKey] = Date.now() + dedupWindowMs;

    const pending = getPendingSupplement();
    sendDebugLog(`[${getMatchTime()}] 补单检查: pending=${pending ? pending.betTeamName : 'null'} alertShown=${supplementAlertShown} team=${team} betTeam=${pending ? pending.betTeam : 'N/A'}`);
    if (pending && !supplementAlertShown) {
      const currentMatchId = getMatchId();
      if (pending.matchId && currentMatchId && pending.matchId !== currentMatchId) {
        sendDebugLog(`[${getMatchTime()}] 跳过补单: 待补单来自比赛${pending.matchId}，当前比赛${currentMatchId}，不匹配`);
      } else if (team !== pending.betTeam) {
        chrome.storage.local.get(['supplementMode'], (settings) => {
          const supplementMode = settings.supplementMode || 'possession';
          const isDangerous = eventType === 'dangerous_attack';

          let shouldTrigger = false;
          if (supplementMode === 'dangerous_attack' && isDangerous) {
            shouldTrigger = true;
          } else if (supplementMode === 'attack' && !isDangerous) {
            shouldTrigger = true;
          } else if (supplementMode === 'possession') {
            if (possessionTimers[teamName]) {
              sendDebugLog(`[${getMatchTime()}] 控球模式下${teamName}已有计时器，跳过进攻触发`);
              return;
            } else {
              sendDebugLog(`[${getMatchTime()}] 控球模式下${teamName}无活跃计时器，进攻立即触发补单`);
              shouldTrigger = true;
            }
          }

          if (!shouldTrigger) {
            sendDebugLog(`[${getMatchTime()}] 跳过补单: 当前模式${supplementMode}不触发`);
            return;
          }

          supplementAlertShown = true;
          sendDebugLog(`[${getMatchTime()}] ★★★ 触发补单提醒: ${teamName} ${eventText} (此前下注: ${pending.betTeamName})`);
          safeSendMessage({
            type: 'LOG',
            data: {
              matchId: getMatchId(),
              eventType: 'supplement',
              team: team,
              teamName: teamName,
              minute: minute,
              source: 'iframe',
              isAlert: true,
              timestamp: new Date().toISOString(),
              url: window.location.href
            }
          });
          showSupplementAlert(teamName, eventType, minute, team, pending);
        });
      } else {
        sendDebugLog(`[${getMatchTime()}] 同一方进攻，不触发补单`);
      }
    }

    safeSendMessage({
      type: 'DETECTION_LOG',
      data: {
        source: 'iframe',
        matchId: getMatchId(),
        eventType: eventType,
        team: team,
        teamName: teamName,
        minute: minute,
        url: window.location.href
      }
    });
  }

  function showHitAlert(teamName, minute, team, betInfo) {
    const existingAlert = document.getElementById('mp-visual-alert');
    if (existingAlert) existingAlert.remove();
    const existingOverlay = document.getElementById('mp-alert-overlay');
    if (existingOverlay) existingOverlay.remove();
    const existingSupplement = document.getElementById('mp-supplement-alert');
    if (existingSupplement) existingSupplement.remove();
    const existingHit = document.getElementById('mp-hit-alert');
    if (existingHit) existingHit.remove();

    const isHome = team === 'home';
    const accentColor = '#ffd700';
    const accentGlow = 'rgba(255,215,0,0.5)';
    const position = isHome ? 'left: 16px; transform: translateY(-50%) scale(0.8);' : 'right: 16px; transform: translateY(-50%) scale(0.8);';
    const activePosition = isHome ? 'left: 16px; transform: translateY(-50%) scale(1);' : 'right: 16px; transform: translateY(-50%) scale(1);';

    const overlay = document.createElement('div');
    overlay.id = 'mp-alert-overlay';
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: transparent; z-index: 9999998; opacity: 0;
      pointer-events: none; transition: opacity 0.3s ease;
    `;
    document.body.appendChild(overlay);

    const alertDiv = document.createElement('div');
    alertDiv.id = 'mp-hit-alert';
    alertDiv.style.cssText = `
      position: fixed; top: 50%; ${position}
      z-index: 9999999;
      background: rgba(10,15,30,0.96);
      color: #e0e6f0; padding: 0; border-radius: 12px;
      box-shadow: 0 0 50px ${accentGlow}, 0 8px 32px rgba(0,0,0,0.6);
      text-align: center;
      transition: all 0.35s cubic-bezier(0.34,1.56,0.64,1);
      border-left: 3px solid ${accentColor};
      overflow: hidden; min-width: 240px;
    `;

    alertDiv.innerHTML = `
      <div style="background:${accentColor};padding:10px 16px;display:flex;align-items:center;justify-content:center;gap:8px;">
        <span style="font-size:16px;">★</span>
        <span style="font-size:15px;font-weight:700;color:#1a1a2e;letter-spacing:1px;">命中确认</span>
      </div>
      <div style="padding:14px 16px 12px;">
        <div style="font-size:13px;color:#8899aa;margin-bottom:4px;">${minute}' · ${teamName} ${isHome ? '(主)' : '(客)'} 进球</div>
        <div style="font-size:11px;color:#667788;margin-bottom:10px;">标记命中，无需对冲</div>
        <button id="mp-close-hit" style="background:${accentColor};color:#1a1a2e;
          border: none; padding: 7px 24px; font-size: 12px; font-weight: 700;
          border-radius: 6px; cursor: pointer; letter-spacing:0.5px;">
          确认
        </button>
      </div>
    `;

    document.body.appendChild(alertDiv);

    setTimeout(() => {
      alertDiv.style.cssText = `
        position: fixed; top: 50%; ${activePosition}
        z-index: 9999999;
        background: rgba(10,15,30,0.96);
        color: #e0e6f0; padding: 0; border-radius: 12px;
        box-shadow: 0 0 50px ${accentGlow}, 0 8px 32px rgba(0,0,0,0.6);
        text-align: center;
        transition: all 0.35s cubic-bezier(0.34,1.56,0.64,1);
        border-left: 3px solid ${accentColor};
        overflow: hidden; min-width: 240px;
      `;
    }, 10);

    document.getElementById('mp-close-hit').addEventListener('click', () => {
      alertDiv.style.opacity = '0';
      alertDiv.style.transform = alertDiv.style.transform.replace('scale(1)', 'scale(0.9)');
      setTimeout(() => {
        alertDiv.remove();
        overlay.remove();
      }, 250);
    });

    setTimeout(() => {
      if (alertDiv && alertDiv.parentNode) {
        alertDiv.style.opacity = '0';
        alertDiv.style.transform = alertDiv.style.transform.replace('scale(1)', 'scale(0.9)');
        setTimeout(() => {
          alertDiv.remove();
          overlay.remove();
        }, 250);
      }
    }, 10000);
  }

  function processGoalEvent(labelElement, teams, detectedTeamName) {
    Object.keys(possessionTimers).forEach(tn => clearPossessionTimer(tn));

    let teamName = detectedTeamName;
    let team = 'home';

    const popModel = labelElement.closest('.pop-model') || labelElement.closest('[class*="pop"]');
    if (popModel) {
      const classList = popModel.className || '';
      if (classList.includes('away')) team = 'away';
      else if (classList.includes('home')) team = 'home';
    }

    if (teamName && teamName !== '未知') {
      if (teamName === teams.away) team = 'away';
      else if (teamName === teams.home) team = 'home';
    }

    if (!teamName || teamName === '未知') {
      teamName = team === 'home' ? teams.home : teams.away;
    }

    const minute = getCurrentMinute();
    const eventId = `goal-${teamName}-${minute}`;

    if (sentEventIds.has(eventId)) {
      return;
    }
    sentEventIds.add(eventId);
    setTimeout(() => sentEventIds.delete(eventId), 30000);

    sendDebugLog(`[${getMatchTime()}] >>> 检测到进球: ${teamName}(${team})`);

    const goalCooldownKey = `goal-${teamName}`;
    const goalCooldownUntil = cooldownMap[goalCooldownKey] || 0;
    if (Date.now() < goalCooldownUntil) {
      sendDebugLog(`[${getMatchTime()}] 进球冷却中: ${goalCooldownKey} 剩余${Math.round((goalCooldownUntil - Date.now()) / 1000)}s`);
      return;
    }
    cooldownMap[goalCooldownKey] = Date.now() + dedupWindowMs;

    const pending = getPendingSupplement();
    if (pending && team === pending.betTeam) {
      const currentMatchId = getMatchId();
      if (pending.matchId && currentMatchId && pending.matchId !== currentMatchId) {
        sendDebugLog(`[${getMatchTime()}] 跳过命中: 待补单来自比赛${pending.matchId}，当前比赛${currentMatchId}，不匹配`);
      } else {
        sendDebugLog(`[${getMatchTime()}] ★★★ 命中! ${teamName} 进球 (此前下注: ${pending.betTeamName})`);
        const hitRecord = {
          type: 'hit',
          matchId: getMatchId(),
          team: team,
          eventType: 'goal',
          teamName: teamName,
          minute: minute,
          timestamp: new Date().toISOString(),
          url: window.location.href,
          relatedBetId: pending.betId
        };
        addBetRecord(hitRecord);
        safeSendMessage({ type: 'BET_RECORD', data: hitRecord });
        showHitAlert(teamName, minute, team, pending);
        clearPendingSupplement();
        safeSendMessage({ type: 'CLEAR_PENDING_SUPPLEMENT' });
        supplementAlertShown = false;
      }
    }

    safeSendMessage({
      type: 'DETECTION_LOG',
      data: {
        source: 'iframe',
        matchId: getMatchId(),
        eventType: 'goal',
        team: team,
        teamName: teamName,
        minute: minute,
        url: window.location.href
      }
    });
  }

  const sentEventIds = new Set();
  let supplementAlertShown = false;
  let visualAlertActive = false;
  const cooldownMap = {};
  let dedupWindowMs = 15000;
  const possessionTimers = {};
  let possessionThresholdMs = 2000;
  let possessionSupplementCooldown = 0;

  function sendDebugLog(message) {
    safeSendMessage({
      type: 'DEBUG_LOG',
      data: {
        time: new Date().toLocaleTimeString('zh-CN'),
        message: '[视觉信号] ' + message
      }
    });
    console.log('[MatchPulse]', message);
  }

  function clearPossessionTimer(teamName) {
    if (possessionTimers[teamName]) {
      clearTimeout(possessionTimers[teamName]);
      delete possessionTimers[teamName];
    }
  }

  function processPossessionEvent(detectedTeamName, teams) {
    let team = null;
    let teamName = detectedTeamName;
    if (detectedTeamName) {
      if (detectedTeamName === teams.home) team = 'home';
      else if (detectedTeamName === teams.away) team = 'away';
    }
    if (!teamName) {
      teamName = team === 'home' ? teams.home : team === 'away' ? teams.away : '未知';
    }

    chrome.storage.local.get(['supplementMode', 'possessionThresholdSec'], (result) => {
      const supplementMode = result.supplementMode || 'possession';
      if (supplementMode !== 'possession') {
        return;
      }
      
      possessionThresholdMs = (result.possessionThresholdSec || 3) * 1000;

      const pending = getPendingSupplement();
      if (!pending) {
        return;
      }
      
      const currentMatchId = getMatchId();
      if (pending.matchId && currentMatchId && pending.matchId !== currentMatchId) {
        return;
      }
      
      if (supplementAlertShown) {
        return;
      }
      
      if (Date.now() < possessionSupplementCooldown) {
        return;
      }
      
      if (team === pending.betTeam) {
        const oppositeTeamName = pending.oppositeTeamName;
        if (oppositeTeamName) {
          clearPossessionTimer(oppositeTeamName);
        }
        return;
      }
      
      if (team !== pending.oppositeTeam) {
        clearPossessionTimer(teamName);
        return;
      }
      
      if (possessionTimers[teamName]) {
        return;
      }
      
      sendDebugLog(`[控球计时] ${teamName} 开始控球，${possessionThresholdMs/1000}秒后触发提醒`);
      possessionTimers[teamName] = setTimeout(() => {
        delete possessionTimers[teamName];
        
        possessionSupplementCooldown = Date.now() + dedupWindowMs;
        
        supplementAlertShown = true;
        
        const minute = getCurrentMinute();
        
        safeSendMessage({
          type: 'LOG',
          data: {
            matchId: currentMatchId,
            eventType: 'supplement',
            team: team,
            teamName: teamName,
            minute: minute,
            source: 'iframe',
            isAlert: true,
            timestamp: new Date().toISOString(),
            url: window.location.href
          }
        });
        
        sendDebugLog(`[控球触发] ${teamName} 持续控球 ${possessionThresholdMs/1000}秒，触发补单提醒`);
        
        showSupplementAlert(teamName, 'possession', minute, team, pending);
      }, possessionThresholdMs);
    });
  }

  function showVisualAlert(teamName, eventType, minute, team) {
    const existingAlert = document.getElementById('mp-visual-alert');
    if (existingAlert) {
      existingAlert.remove();
    }

    visualAlertActive = true;

    const eventText = eventType === 'corner' ? '角球' : '危险任意球';
    const eventIcon = eventType === 'corner' ? '◆' : '▲';
    const accentColor = eventType === 'corner' ? '#ff4757' : '#ff6b35';
    const accentGlow = eventType === 'corner' ? 'rgba(255,71,87,0.4)' : 'rgba(255,107,53,0.4)';
    const isHome = team === 'home';

    const position = isHome ? 'left: 16px; transform: translateY(-50%) scale(0.8);' : 'right: 16px; transform: translateY(-50%) scale(0.8);';
    const activePosition = isHome ? 'left: 16px; transform: translateY(-50%) scale(1);' : 'right: 16px; transform: translateY(-50%) scale(1);';

    const overlay = document.createElement('div');
    overlay.id = 'mp-alert-overlay';
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: transparent; z-index: 9999998; opacity: 0;
      pointer-events: none; transition: opacity 0.3s ease;
    `;
    document.body.appendChild(overlay);

    const alertDiv = document.createElement('div');
    alertDiv.id = 'mp-visual-alert';
    alertDiv.style.cssText = `
      position: fixed; top: 50%; ${position}
      z-index: 9999999;
      background: rgba(10,15,30,0.96);
      color: #e0e6f0; padding: 0; border-radius: 12px;
      box-shadow: 0 0 40px ${accentGlow}, 0 8px 32px rgba(0,0,0,0.6);
      text-align: center;
      transition: all 0.35s cubic-bezier(0.34,1.56,0.64,1);
      border-left: 3px solid ${accentColor};
      overflow: hidden; min-width: 220px;
    `;

    alertDiv.innerHTML = `
      <div style="background:${accentColor};padding:10px 16px;display:flex;align-items:center;justify-content:center;gap:8px;">
        <span style="font-size:16px;">${eventIcon}</span>
        <span style="font-size:15px;font-weight:700;color:#fff;letter-spacing:1px;">${eventText}信号</span>
      </div>
      <div style="padding:14px 16px 12px;">
        <div style="font-size:13px;color:#8899aa;margin-bottom:6px;">${minute}' · ${teamName} ${isHome ? '(主)' : '(客)'}
        <div style="display:flex;gap:8px;justify-content:center;margin-top:10px;">
          <button id="mp-bet-btn" style="background:${accentColor};color:#fff;
            border: none; padding: 7px 18px; font-size: 12px; font-weight: 600;
            border-radius: 6px; cursor: pointer; letter-spacing:0.5px;">
            标记信号
          </button>
          <button id="mp-close-alert" style="background:rgba(255,255,255,0.06);color:#8899aa;
            border: 1px solid rgba(255,255,255,0.08); padding: 7px 14px; font-size: 12px;
            font-weight: 500; border-radius: 6px; cursor: pointer;">
            忽略
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(alertDiv);

    setTimeout(() => {
      alertDiv.style.cssText = `
        position: fixed; top: 50%; ${activePosition}
        z-index: 9999999;
        background: rgba(10,15,30,0.96);
        color: #e0e6f0; padding: 0; border-radius: 12px;
        box-shadow: 0 0 40px ${accentGlow}, 0 8px 32px rgba(0,0,0,0.6);
        text-align: center;
        transition: all 0.35s cubic-bezier(0.34,1.56,0.64,1);
        border-left: 3px solid ${accentColor};
        overflow: hidden; min-width: 220px;
      `;
    }, 10);

    document.getElementById('mp-close-alert').addEventListener('click', () => {
      visualAlertActive = false;
      alertDiv.style.opacity = '0';
      alertDiv.style.transform = alertDiv.style.transform.replace('scale(1)', 'scale(0.9)');
      setTimeout(() => {
        alertDiv.remove();
        overlay.remove();
      }, 250);
    });

    const betBtn = document.getElementById('mp-bet-btn');
    if (betBtn) {
      betBtn.addEventListener('click', () => {
        const betRecord = {
          type: 'bet',
          matchId: getMatchId(),
          team: team,
          eventType: eventType,
          teamName: teamName,
          minute: minute,
          timestamp: new Date().toISOString(),
          url: window.location.href
        };
        const savedRecord = addBetRecord(betRecord);
        safeSendMessage({ type: 'BET_RECORD', data: savedRecord });
        const oppositeTeam = team === 'home' ? 'away' : 'home';
        const oppositeTeamName = team === 'home' ? getTeamNames().away : getTeamNames().home;
        const pendingData = {
          betId: savedRecord.id,
          matchId: getMatchId(),
          betTeam: team,
          betTeamName: teamName,
          oppositeTeam: oppositeTeam,
          oppositeTeamName: oppositeTeamName,
          betEventType: eventType,
          betMinute: minute,
          betTimestamp: betRecord.timestamp
        };
        setPendingSupplement(pendingData);
        safeSendMessage({ type: 'SET_PENDING_SUPPLEMENT', data: pendingData });
        supplementAlertShown = false;
        sendDebugLog(`[${getMatchTime()}] ✅ 用户已下注: ${teamName} ${eventText}，等待${oppositeTeamName}进攻补单`);
        betBtn.style.background = '#00e676';
        betBtn.textContent = '✓ 已标记';
        betBtn.disabled = true;
        visualAlertActive = false;
        alertDiv.style.opacity = '0';
        alertDiv.style.transform = alertDiv.style.transform.replace('scale(1)', 'scale(0.9)');
        setTimeout(() => {
          alertDiv.remove();
          overlay.remove();
        }, 250);
      });
    }

    setTimeout(() => {
      if (alertDiv && alertDiv.parentNode) {
        visualAlertActive = false;
        alertDiv.style.opacity = '0';
        alertDiv.style.transform = alertDiv.style.transform.replace('scale(1)', 'scale(0.9)');
        setTimeout(() => {
          alertDiv.remove();
          overlay.remove();
        }, 250);
      }
    }, 30000);
  }

  let cachedMatchTime = '';
  let lastTimeCheck = 0;
  const TIME_CACHE_DURATION = 500;

  function getMatchTime() {
    const now = Date.now();
    if (now - lastTimeCheck < TIME_CACHE_DURATION && cachedMatchTime) {
      return cachedMatchTime;
    }
    
    const timeSpan = document.querySelector('.time > span:first-child');
    if (timeSpan) {
      cachedMatchTime = timeSpan.textContent.trim();
      lastTimeCheck = now;
      return cachedMatchTime;
    }
    
    const timeElement = document.querySelector('.time');
    if (timeElement) {
      const text = timeElement.textContent.trim();
      const match = text.match(/(\d+:\d+)/);
      if (match) {
        cachedMatchTime = match[1];
        lastTimeCheck = now;
        return cachedMatchTime;
      }
    }
    return '--:--';
  }

  let cachedMinute = '';
  let lastMinuteCheck = 0;
  const MINUTE_CACHE_DURATION = 800;

  function getCurrentMinute() {
    const now = Date.now();
    if (now - lastMinuteCheck < MINUTE_CACHE_DURATION && cachedMinute) {
      return cachedMinute;
    }
    
    const time = getMatchTime();
    const match = time.match(/(\d+)/);
    cachedMinute = match ? match[1] : Math.floor(Date.now() / 60000).toString();
    lastMinuteCheck = now;
    return cachedMinute;
  }

  function getMatchId() {
    try {
      if (window.parent && window.parent.location.pathname) {
        const match = window.parent.location.pathname.match(/detail-(\d+)/);
        if (match) return match[1];
      }
    } catch (e) {}
    try {
      const ref = document.referrer;
      if (ref) {
        const match = ref.match(/detail-(\d+)/);
        if (match) return match[1];
      }
    } catch (e) {}
    return null;
  }

  function getTeamNames() {
    const now = Date.now();
    
    if (now - lastTeamCheckTime < TEAM_CACHE_DURATION && 
        cachedTeamElements.home && cachedTeamElements.away) {
      return {
        home: cachedTeamElements.home,
        away: cachedTeamElements.away
      };
    }
    
    const teams = { home: '主队', away: '客队' };
    const leftName = document.querySelector('.left-box .name');
    const rightName = document.querySelector('.right-box .name');
    if (leftName && rightName) {
      teams.home = leftName.textContent.trim();
      teams.away = rightName.textContent.trim();
      cachedTeamElements.home = teams.home;
      cachedTeamElements.away = teams.away;
      lastTeamCheckTime = now;
    }
    return teams;
  }

  function sendTeamNamesToBg(teams) {
    const matchId = getMatchId();
    if ((teams.home !== '主队' || teams.away !== '客队') && matchId) {
      safeSendMessage({
        type: 'SET_TEAM_NAMES',
        data: { home: teams.home, away: teams.away, matchId: matchId }
      });
    }
  }

  let lastDetectedEvent = '';

  function checkLiveEvents() {
    const teams = getTeamNames();

    sendTeamNamesToBg(teams);

    const allLabels = document.querySelectorAll('.label');

    if (allLabels.length === 0) {
      return;
    }

    allLabels.forEach((labelElement, index) => {
      const label = labelElement.textContent.trim();
      const textBox = labelElement.closest('.text-box') || labelElement.parentElement;
      const teamTextElement = textBox?.querySelector('.text.mb') || textBox?.querySelector('.text');
      const teamName = teamTextElement ? teamTextElement.textContent.trim() : '未知';

      const currentEvent = `${teamName}-${label}`;

      if (currentEvent !== lastDetectedEvent) {
        lastDetectedEvent = currentEvent;
        const matchTime = getMatchTime();
        sendDebugLog(`[${matchTime}] 事件: "${teamName}" - "${label}"`);
      }

      if (label === '角球' || label.includes('角球')) {
        processLabelEvent(labelElement, 'corner', teams, teamName);
      }

      if (label === '危险任意球' || label.includes('危险任意球')) {
        processLabelEvent(labelElement, 'dangerous_freekick', teams, teamName);
      }

      if (label === '进攻' || label === '危险进攻' || label.includes('进攻') || label.includes('危险进攻')) {
        const attackType = (label === '危险进攻' || label.includes('危险进攻')) ? 'dangerous_attack' : 'attack';
        processAttackEvent(labelElement, attackType, teams, teamName);
      }

      if (label === '控球' || label.includes('控球')) {
        processPossessionEvent(teamName, teams);
      }

      if (label === '进球' || label.includes('进球') || label === '点球进球' || label.includes('点球')) {
        processGoalEvent(labelElement, teams, teamName);
      }
    });
  }

  function processLabelEvent(labelElement, eventType, teams, detectedTeamName) {
    let teamName = detectedTeamName;
    let team = 'home';

    const popModel = labelElement.closest('.pop-model') || labelElement.closest('[class*="pop"]');
    if (popModel) {
      const classList = popModel.className || '';
      if (classList.includes('away')) {
        team = 'away';
      } else if (classList.includes('home')) {
        team = 'home';
      }
    }

    if (teamName && teamName !== '未知') {
      if (teamName === teams.away) {
        team = 'away';
      } else if (teamName === teams.home) {
        team = 'home';
      }
    }

    if (!teamName || teamName === '未知') {
      teamName = team === 'home' ? teams.home : teams.away;
    }

    const minute = getCurrentMinute();
    const eventId = `${eventType}-${teamName}-${minute}`;
    const now = Date.now();

    if (!shouldAlert(minute)) {
      safeSendMessage({
        type: 'DETECTION_LOG',
        data: {
          source: 'iframe',
          matchId: getMatchId(),
          eventType,
          team,
          teamName,
          minute,
          url: window.location.href
        }
      });
      return;
    }

    const cooldownKey = `${eventType}-${teamName}`;
    const cooldownUntil = cooldownMap[cooldownKey] || 0;
    if (now < cooldownUntil) {
      return;
    }

    if (sentEventIds.has(eventId)) {
      return;
    }
    sentEventIds.add(eventId);
    setTimeout(() => sentEventIds.delete(eventId), 30000);

    if (visualAlertActive) {
      return;
    }

    const eventText = eventType === 'corner' ? '角球' : '危险任意球';
    sendDebugLog(`[${getMatchTime()}] >>> 发送 ALERT_REQUEST: ${eventText} ${teamName}(${team}) ${minute}'`);

    safeSendMessage({
      type: 'ALERT_REQUEST',
      data: {
        source: 'iframe',
        matchId: getMatchId(),
        eventType,
        team,
        teamName,
        minute,
        timestamp: new Date().toISOString(),
        url: window.location.href
      }
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('[MatchPulse] 发送ALERT_REQUEST失败:', chrome.runtime.lastError.message);
        return;
      }
      if (response && response.status === 'dedup') {
        sendDebugLog(`[${getMatchTime()}] ⛔ iframe提醒被去重: ${eventText} ${teamName} (${response.reason})`);
      } else {
        sendDebugLog(`[${getMatchTime()}] ★★★ iframe提醒已触发: ${eventText} ${teamName}`);
        cooldownMap[cooldownKey] = Date.now() + dedupWindowMs;
        showVisualAlert(teamName, eventType, minute, team);
      }
    });
  }

  let observerThrottleTimer = null;

  function startObserver() {
    const observer = new MutationObserver(() => {
      if (observerThrottleTimer) return;
      observerThrottleTimer = setTimeout(() => {
        observerThrottleTimer = null;
        checkLiveEvents();
      }, CONFIG.OBSERVER_THROTTLE);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    });

    sendDebugLog('MutationObserver 已启动(性能优化版)');
  }

  function init() {
    sendDebugLog('iframe脚本已加载(性能优化版): ' + window.location.href.substring(0, 50));
    loadStartAlertState();
    loadTimeSettings();
    
    recordedEvents = getRecordedEvents();

    cachedPendingSupplement = getPendingSupplementFromLocal();
    syncPendingSupplementFromStorage();

    const currentMatchId = getMatchId();
    if (cachedPendingSupplement && cachedPendingSupplement.matchId && currentMatchId && cachedPendingSupplement.matchId !== currentMatchId) {
      sendDebugLog(`[init] 待补单来自比赛${cachedPendingSupplement.matchId}，当前比赛${currentMatchId}，不匹配，已清除`);
      clearPendingSupplement();
      safeSendMessage({ type: 'CLEAR_PENDING_SUPPLEMENT' });
    }

    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === 'local') {
        if (changes.firstHalfStart || changes.firstHalfEnd || changes.secondHalfStart || changes.secondHalfEnd || changes.dedupWindowSec) {
          loadTimeSettings();
        }
        if (changes.pendingSupplement) {
          if (changes.pendingSupplement.newValue) {
            cachedPendingSupplement = changes.pendingSupplement.newValue;
            try {
              localStorage.setItem(PENDING_SUPPLEMENT_KEY, JSON.stringify(changes.pendingSupplement.newValue));
            } catch (e) {}
            sendDebugLog(`[补单同步] storage变更同步待补单: ${changes.pendingSupplement.newValue.betTeamName}`);
          } else {
            cachedPendingSupplement = null;
            try { localStorage.removeItem(PENDING_SUPPLEMENT_KEY); } catch (e) {}
            sendDebugLog('[补单同步] storage变更清除待补单');
          }
        }
      }
    });

    startObserver();
    setInterval(() => {
      checkLiveEvents();
      checkStartAlert();
      syncPendingSupplementFromStorage();
    }, CONFIG.CHECK_INTERVAL);
    setTimeout(checkLiveEvents, 500);
  }

  function getPendingSupplementFromLocal() {
    try {
      const data = localStorage.getItem(PENDING_SUPPLEMENT_KEY);
      if (data) return JSON.parse(data);
    } catch (e) {}
    return null;
  }

  chrome.storage.local.get(['auth_token'], (result) => {
    if (!result.auth_token) {
      console.log('[MatchPulse] 未登录，内容脚本已禁用');
      return;
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  });
})();
