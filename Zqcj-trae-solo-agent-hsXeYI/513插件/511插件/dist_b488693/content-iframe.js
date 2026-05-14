 // MatchPulse - 赛事数据引擎 动画信号采集模块
// 采集比赛动画区域的角球和危险任意球事件信号

(function() {
  'use strict';

  const CONFIG = {
    CHECK_INTERVAL: 500,
  };

  const STORAGE_KEY = 'mp_iframe_events';
  const BET_RECORDS_KEY = 'mp_bet_records';
  const PENDING_SUPPLEMENT_KEY = 'mp_pending_supplement';
  
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
      // 上半场：检查是否在开始时间和结束时间之间
      return min >= timeSettings.firstHalfStart && min <= timeSettings.firstHalfEnd;
    } else {
      // 下半场：检查是否在开始时间和结束时间之间
      return min >= timeSettings.secondHalfStart && min <= timeSettings.secondHalfEnd;
    }
  }

  // 显示开始警示
  function showStartAlert(half) {
    const halfText = half === 'first' ? '上半场' : '下半场';
    const startTime = half === 'first' ? timeSettings.firstHalfStart : timeSettings.secondHalfStart;
    const endTime = half === 'first' ? timeSettings.firstHalfEnd : timeSettings.secondHalfEnd;

    // 移除已有的提醒框
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

    // 播放开始警示声音（使用自定义声音或默认声音）
    safeSendMessage({
      type: 'PLAY_SOUND',
      data: { team: 'home', eventType: 'startAlert' }
    });

    // 5秒后自动消失
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
      // 上半场：到达开始时间时触发
      if (min >= timeSettings.firstHalfStart && timeSettings.firstHalfStart > 0) {
        startAlertTriggered.firstHalf = true;
        saveStartAlertState();
        showStartAlert('first');
      }
    } else if (half === 'second' && !startAlertTriggered.secondHalf) {
      // 下半场：到达开始时间时触发
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

  // ===== 下注/补单 数据管理 =====

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

  // ===== 补单提醒弹窗 =====
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

    // 播放补单提示音
    safeSendMessage({
      type: 'PLAY_SOUND',
      data: { team: 'supplement', eventType: 'supplement' }
    });
  }

  // ===== 处理进攻/危险进攻事件 =====
  function processAttackEvent(labelElement, eventType, teams, detectedTeamName) {
    // 进攻事件出现时清除所有控球计时器（球权已变化）
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

    // 本地去重：同一进攻事件只处理一次
    if (sentEventIds.has(eventId)) {
      return;
    }
    sentEventIds.add(eventId);
    setTimeout(() => sentEventIds.delete(eventId), 30000);

    const eventText = eventType === 'attack' ? '进攻' : '危险进攻';
    sendDebugLog(`[${getMatchTime()}] >>> 检测到${eventText}: ${teamName}(${team})`);

    // 球队级冷却：同一球队进攻事件冷却期内不重复处理
    const attackCooldownKey = `${eventType}-${teamName}`;
    const attackCooldownUntil = cooldownMap[attackCooldownKey] || 0;
    if (Date.now() < attackCooldownUntil) {
      sendDebugLog(`[${getMatchTime()}] 进攻冷却中: ${attackCooldownKey} 剩余${Math.round((attackCooldownUntil - Date.now()) / 1000)}s`);
      return;
    }
    cooldownMap[attackCooldownKey] = Date.now() + dedupWindowMs;

    // 检查是否有待补单
    const pending = getPendingSupplement();
    sendDebugLog(`[${getMatchTime()}] 补单检查: pending=${pending ? pending.betTeamName : 'null'} alertShown=${supplementAlertShown} team=${team} betTeam=${pending ? pending.betTeam : 'N/A'}`);
    if (pending && !supplementAlertShown) {
      // 检查待补单是否属于当前比赛
      const currentMatchId = getMatchId();
      if (pending.matchId && currentMatchId && pending.matchId !== currentMatchId) {
        sendDebugLog(`[${getMatchTime()}] 跳过补单: 待补单来自比赛${pending.matchId}，当前比赛${currentMatchId}，不匹配`);
      } else
      // 如果当前进攻方是下注方的对方，触发补单提醒
      if (team !== pending.betTeam) {
        // 检查补单触发模式设置
        chrome.storage.local.get(['supplementMode'], (settings) => {
          const supplementMode = settings.supplementMode || 'possession';
          const isDangerous = eventType === 'dangerous_attack';

          // 检查是否应该触发
          let shouldTrigger = false;
          if (supplementMode === 'dangerous_attack' && isDangerous) {
            shouldTrigger = true;
          } else if (supplementMode === 'attack' && !isDangerous) {
            shouldTrigger = true;
          } else if (supplementMode === 'possession') {
            // 控球模式：如果该球队已有活跃计时器，跳过（计时器会触发）
            // 如果没有活跃计时器，立即触发（抢时间）
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

    // 记录进攻事件日志
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

  // ===== 命中弹窗 =====
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

  // ===== 处理进球事件 =====
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

    // 本地去重：同一进球事件只处理一次
    if (sentEventIds.has(eventId)) {
      return;
    }
    sentEventIds.add(eventId);
    setTimeout(() => sentEventIds.delete(eventId), 30000);

    sendDebugLog(`[${getMatchTime()}] >>> 检测到进球: ${teamName}(${team})`);

    // 球队级冷却：同一球队进球事件冷却期内不重复处理
    const goalCooldownKey = `goal-${teamName}`;
    const goalCooldownUntil = cooldownMap[goalCooldownKey] || 0;
    if (Date.now() < goalCooldownUntil) {
      sendDebugLog(`[${getMatchTime()}] 进球冷却中: ${goalCooldownKey} 剩余${Math.round((goalCooldownUntil - Date.now()) / 1000)}s`);
      return;
    }
    cooldownMap[goalCooldownKey] = Date.now() + dedupWindowMs;

    // 检查是否有待补单，且进球方是下注方
    const pending = getPendingSupplement();
    if (pending && team === pending.betTeam) {
      // 检查待补单是否属于当前比赛
      const currentMatchId = getMatchId();
      if (pending.matchId && currentMatchId && pending.matchId !== currentMatchId) {
        sendDebugLog(`[${getMatchTime()}] 跳过命中: 待补单来自比赛${pending.matchId}，当前比赛${currentMatchId}，不匹配`);
      } else {
        sendDebugLog(`[${getMatchTime()}] ★★★ 命中! ${teamName} 进球 (此前下注: ${pending.betTeamName})`);
        // 记录命中
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
        // 同步到 background
        safeSendMessage({ type: 'BET_RECORD', data: hitRecord });
        // 显示命中弹窗
        showHitAlert(teamName, minute, team, pending);
        // 清除待补单
        clearPendingSupplement();
        // 同步清除待补单到 background
        safeSendMessage({ type: 'CLEAR_PENDING_SUPPLEMENT' });
        supplementAlertShown = false;
      }
    }

    // 记录进球事件日志
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

  // 本地已发送过的事件ID（基于 eventId），防止同一动画帧反复触发
  // 跨来源的时间去重由 background 统一处理
  const sentEventIds = new Set();
  // 补单弹窗是否已显示（防止同一待补单重复弹窗）
  let supplementAlertShown = false;
  // 视觉弹窗是否已显示（防止角球/任意球重复弹窗）
  let visualAlertActive = false;
  // 球队级冷却Map：同一球队同类事件15秒内只弹一次（防止同一角球多个动画元素重复触发）
  const cooldownMap = {};
  let dedupWindowMs = 15000;
  // 控球计时器
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

  // 清除指定球队的控球计时器
  function clearPossessionTimer(teamName) {
    if (possessionTimers[teamName]) {
      clearTimeout(possessionTimers[teamName]);
      delete possessionTimers[teamName];
    }
  }

  // 处理控球事件
  function processPossessionEvent(detectedTeamName, teams) {
    // 识别控球方球队
    let team = null;
    let teamName = detectedTeamName;
    if (detectedTeamName) {
      if (detectedTeamName === teams.home) team = 'home';
      else if (detectedTeamName === teams.away) team = 'away';
    }
    if (!teamName) {
      teamName = team === 'home' ? teams.home : team === 'away' ? teams.away : '未知';
    }

    // 读取补单模式设置
    chrome.storage.local.get(['supplementMode', 'possessionThresholdSec'], (result) => {
      const supplementMode = result.supplementMode || 'possession';
      if (supplementMode !== 'possession') {
        return; // 非控球模式不处理
      }
      
      possessionThresholdMs = (result.possessionThresholdSec || 3) * 1000;

      // 检查是否有待补单
      const pending = getPendingSupplement();
      if (!pending) {
        return;
      }
      
      // 检查比赛ID是否匹配
      const currentMatchId = getMatchId();
      if (pending.matchId && currentMatchId && pending.matchId !== currentMatchId) {
        return;
      }
      
      // 检查补单弹窗是否已显示
      if (supplementAlertShown) {
        return;
      }
      
      // 检查控球冷却
      if (Date.now() < possessionSupplementCooldown) {
        return;
      }
      
      // 如果控球方是下注方，清除对方的计时器并返回
      if (team === pending.betTeam) {
        const oppositeTeamName = pending.oppositeTeamName;
        if (oppositeTeamName) {
          clearPossessionTimer(oppositeTeamName);
        }
        return;
      }
      
      // 如果控球方不是待补单的对方，清除该方的计时器
      if (team !== pending.oppositeTeam) {
        clearPossessionTimer(teamName);
        return;
      }
      
      // 如果该球队已有活跃计时器，说明正在计时中，返回
      if (possessionTimers[teamName]) {
        return;
      }
      
      // 创建新的控球计时器
      sendDebugLog(`[控球计时] ${teamName} 开始控球，${possessionThresholdMs/1000}秒后触发提醒`);
      possessionTimers[teamName] = setTimeout(() => {
        // 计时器触发
        delete possessionTimers[teamName];
        
        // 设置冷却（防止重复触发，复用去重窗口设置）
        possessionSupplementCooldown = Date.now() + dedupWindowMs;
        
        // 设置补单弹窗标记
        supplementAlertShown = true;
        
        const minute = getCurrentMinute();
        
        // 发送日志
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
        
        // 显示补单弹窗
        showSupplementAlert(teamName, 'possession', minute, team, pending);
      }, possessionThresholdMs);
    });
  }

  // 在页面上显示醒目的提醒框
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
        <div style="font-size:13px;color:#8899aa;margin-bottom:6px;">${minute}' · ${teamName} ${isHome ? '(主)' : '(客)'}</div>
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

    // 关闭按钮事件
    document.getElementById('mp-close-alert').addEventListener('click', () => {
      visualAlertActive = false;
      alertDiv.style.opacity = '0';
      alertDiv.style.transform = alertDiv.style.transform.replace('scale(1)', 'scale(0.9)');
      setTimeout(() => {
        alertDiv.remove();
        overlay.remove();
      }, 250);
    });

    // 已下注按钮事件
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
        // 同步到 background
        safeSendMessage({ type: 'BET_RECORD', data: savedRecord });
        // 设置待补单：对方进攻时提醒
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
        // 同步待补单到 background
        safeSendMessage({ type: 'SET_PENDING_SUPPLEMENT', data: pendingData });
        // 重置补单弹窗标志，允许新的补单提醒
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

    // 30秒后自动消失
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

  function getMatchTime() {
    // 获取比赛时间，如 "96:44" 或 "45+2"
    const timeSpan = document.querySelector('.time > span:first-child');
    if (timeSpan) {
      return timeSpan.textContent.trim();
    }
    // 备选方案
    const timeElement = document.querySelector('.time');
    if (timeElement) {
      const text = timeElement.textContent.trim();
      const match = text.match(/(\d+:\d+)/);
      if (match) return match[1];
    }
    return '--:--';
  }

  function getCurrentMinute() {
    // 获取分钟数用于事件去重
    const time = getMatchTime();
    const match = time.match(/(\d+)/);
    return match ? match[1] : Math.floor(Date.now() / 60000).toString();
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
    const teams = { home: '主队', away: '客队' };
    const leftName = document.querySelector('.left-box .name');
    const rightName = document.querySelector('.right-box .name');
    if (leftName && rightName) {
      teams.home = leftName.textContent.trim();
      teams.away = rightName.textContent.trim();
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

  // 记录上一次检测到的事件，避免重复日志
  let lastDetectedEvent = '';

  function checkLiveEvents() {
    const teams = getTeamNames();

    sendTeamNamesToBg(teams);

    // 查找 iframe 内所有 .text-box .label 或直接 .label
    const allLabels = document.querySelectorAll('.label');

    if (allLabels.length === 0) {
      return;
    }

    allLabels.forEach((labelElement, index) => {
      const label = labelElement.textContent.trim();
      const textBox = labelElement.closest('.text-box') || labelElement.parentElement;
      const teamTextElement = textBox?.querySelector('.text.mb') || textBox?.querySelector('.text');
      const teamName = teamTextElement ? teamTextElement.textContent.trim() : '未知';

      // 生成当前事件标识
      const currentEvent = `${teamName}-${label}`;

      // 记录所有事件变化到日志（避免重复）
      if (currentEvent !== lastDetectedEvent) {
        lastDetectedEvent = currentEvent;
        const matchTime = getMatchTime();
        sendDebugLog(`[${matchTime}] 事件: "${teamName}" - "${label}"`);
      }

      // 角球检测
      if (label === '角球' || label.includes('角球')) {
        sendDebugLog(`[${getMatchTime()}] >>> 匹配到角球! "${teamName}"`);
        processLabelEvent(labelElement, 'corner', teams, teamName);
      }

      // 危险任意球检测
      if (label === '危险任意球' || label.includes('危险任意球')) {
        sendDebugLog(`[${getMatchTime()}] >>> 匹配到危险任意球! "${teamName}"`);
        processLabelEvent(labelElement, 'dangerous_freekick', teams, teamName);
      }

      // 进攻检测
      if (label === '进攻' || label === '危险进攻' || label.includes('进攻') || label.includes('危险进攻')) {
        const attackType = (label === '危险进攻' || label.includes('危险进攻')) ? 'dangerous_attack' : 'attack';
        sendDebugLog(`[${getMatchTime()}] >>> 匹配到${label}! "${teamName}"`);
        processAttackEvent(labelElement, attackType, teams, teamName);
      }

      // 控球检测
      if (label === '控球' || label.includes('控球')) {
        sendDebugLog(`[${getMatchTime()}] >>> 匹配到控球! "${teamName}"`);
        processPossessionEvent(teamName, teams);
      }

      // 进球检测
      if (label === '进球' || label.includes('进球') || label === '点球进球' || label.includes('点球')) {
        sendDebugLog(`[${getMatchTime()}] >>> 匹配到进球! "${teamName}"`);
        processGoalEvent(labelElement, teams, teamName);
      }
    });
  }

  function processLabelEvent(labelElement, eventType, teams, detectedTeamName) {
    let teamName = detectedTeamName;
    let team = 'home';

    // 从父元素判断主客队
    const popModel = labelElement.closest('.pop-model') || labelElement.closest('[class*="pop"]');
    if (popModel) {
      const classList = popModel.className || '';
      if (classList.includes('away')) {
        team = 'away';
      } else if (classList.includes('home')) {
        team = 'home';
      }
    }

    // 通过球队名判断
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

    // 检查是否在允许提醒的时间范围内
    if (!shouldAlert(minute)) {
      sendDebugLog(`[${getMatchTime()}] 跳过: 当前${minute}分未到设定的开始时间，记录日志`);
      // 不在时间窗口，只记录日志不报警
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

    sendDebugLog(`[${getMatchTime()}] 事件ID: ${eventId}`);

    // 球队级冷却：同一球队同类事件15秒内只弹一次（防止同一角球多个动画元素重复触发）
    const cooldownKey = `${eventType}-${teamName}`;
    const cooldownUntil = cooldownMap[cooldownKey] || 0;
    if (now < cooldownUntil) {
      sendDebugLog(`[${getMatchTime()}] 冷却中: ${cooldownKey} 剩余${Math.round((cooldownUntil - now) / 1000)}s`);
      return;
    }

    // 本地去重：同一 eventId 只发一次（防止 MutationObserver 高频触发）
    if (sentEventIds.has(eventId)) {
      return;
    }
    sentEventIds.add(eventId);
    // 30秒后清除，允许下一分钟的同类事件
    setTimeout(() => sentEventIds.delete(eventId), 30000);

    // 防止视觉弹窗重复显示
    if (visualAlertActive) {
      sendDebugLog(`[${getMatchTime()}] 跳过视觉弹窗: 已有弹窗显示中`);
      return;
    }

    const eventText = eventType === 'corner' ? '角球' : '危险任意球';
    sendDebugLog(`[${getMatchTime()}] >>> 发送 ALERT_REQUEST: ${eventText} ${teamName}(${team}) ${minute}'`);

    // 发给 background 统一去重，background 决定是否播放声音
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
      }, 200);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    });

    sendDebugLog('MutationObserver 已启动(200ms节流)');
  }

  function init() {
    sendDebugLog('iframe脚本已加载: ' + window.location.href.substring(0, 50));
    loadStartAlertState();
    loadTimeSettings();
    
    // 初始化已记录事件（按 matchId 隔离）
    recordedEvents = getRecordedEvents();

    cachedPendingSupplement = getPendingSupplementFromLocal();
    syncPendingSupplementFromStorage();

    // 检查待补单是否属于当前比赛，不属于则清除
    const currentMatchId = getMatchId();
    if (cachedPendingSupplement && cachedPendingSupplement.matchId && currentMatchId && cachedPendingSupplement.matchId !== currentMatchId) {
      sendDebugLog(`[init] 待补单来自比赛${cachedPendingSupplement.matchId}，当前比赛${currentMatchId}，不匹配，已清除`);
      clearPendingSupplement();
      safeSendMessage({ type: 'CLEAR_PENDING_SUPPLEMENT' });
    }

    // 监听设置变化
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
