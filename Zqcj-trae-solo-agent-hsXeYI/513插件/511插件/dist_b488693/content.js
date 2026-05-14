// MatchPulse - 赛事数据引擎 文字信号采集模块
// 采集文字解说区域的角球、进攻、进球事件信号

(function() {
  'use strict';

  let timeSettings = { firstHalfStart: 32, firstHalfEnd: 44, secondHalfStart: 78, secondHalfEnd: 88 };
  const sentEventIds = new Set();
  // 球队级冷却Map：同一球队同类事件15秒内只弹一次（防止同一角球多个动画元素重复触发）
  const cooldownMap = {};
  let dedupWindowMs = 15000;
  let observerAttached = false;
  let initialized = false;
  let throttleTimer = null;
  // 控球计时器
  const possessionTimers = {};
  let possessionThresholdMs = 2000;
  let possessionSupplementCooldown = 0;

  function getMatchId() {
    const match = window.location.pathname.match(/detail-(\d+)/);
    return match ? match[1] : null;
  }

  function sendDebugLog(message) {
    console.log('[MatchPulse]', message);
  }

  function loadTimeSettings() {
    chrome.storage.local.get(['firstHalfStart', 'firstHalfEnd', 'secondHalfStart', 'secondHalfEnd', 'dedupWindowSec'], (result) => {
      timeSettings.firstHalfStart = result.firstHalfStart ?? 32;
      timeSettings.firstHalfEnd = result.firstHalfEnd ?? 44;
      timeSettings.secondHalfStart = result.secondHalfStart ?? 78;
      timeSettings.secondHalfEnd = result.secondHalfEnd ?? 88;
      dedupWindowMs = (parseInt(result.dedupWindowSec) || 15) * 1000;
      sendDebugLog(`时间设置已加载: 上半场=${timeSettings.firstHalfStart}-${timeSettings.firstHalfEnd}, 下半场=${timeSettings.secondHalfStart}-${timeSettings.secondHalfEnd}, 冷却=${dedupWindowMs/1000}s`);
    });
  }

  // 清除指定球队的控球计时器
  function clearPossessionTimer(teamName) {
    if (possessionTimers[teamName]) {
      clearTimeout(possessionTimers[teamName]);
      delete possessionTimers[teamName];
    }
  }

  // 处理控球事件
  function processPossessionItem(item, teams) {
    const info = extractItemInfo(item);
    if (!info) return;
    const { text, minute } = info;
    if (!minute) return;

    // 检查是否包含控球
    if (!text.includes('控球')) return;

    // 从括号中提取球队名
    const teamMatch = text.match(/\(([^)]+)\)/);
    const textTeamName = teamMatch ? teamMatch[1] : '';
    let teamName = '未知';
    let team = null;

    if (textTeamName) {
      if (teams.home && (teams.home.includes(textTeamName) || textTeamName.includes(teams.home))) {
        teamName = teams.home; team = 'home';
      } else if (teams.away && (teams.away.includes(textTeamName) || textTeamName.includes(teams.away))) {
        teamName = teams.away; team = 'away';
      }
    }
    if (!team) return;

    // 读取补单模式设置
    chrome.storage.local.get(['supplementMode', 'possessionThresholdSec', 'pendingSupplement'], (result) => {
      const supplementMode = result.supplementMode || 'possession';
      if (supplementMode !== 'possession') {
        return; // 非控球模式不处理
      }
      
      possessionThresholdMs = (result.possessionThresholdSec || 3) * 1000;
      const pending = result.pendingSupplement;
      
      if (!pending) return;
      
      // 检查比赛ID是否匹配
      if (pending.matchId && pending.matchId !== getMatchId()) return;
      
      // 检查控球冷却
      if (Date.now() < possessionSupplementCooldown) return;
      
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
      if (possessionTimers[teamName]) return;
      
      // 创建新的控球计时器
      sendDebugLog(`[${minute}'] 控球计时开始: ${teamName}，${possessionThresholdMs/1000}秒后触发提醒`);
      possessionTimers[teamName] = setTimeout(() => {
        // 计时器触发
        delete possessionTimers[teamName];
        
        // 设置冷却（防止重复触发，复用去重窗口设置）
        possessionSupplementCooldown = Date.now() + dedupWindowMs;
        
        // 发送日志
        sendDebugLog(`[${minute}'] ★ 控球触发补单: ${teamName} 持续控球 ${possessionThresholdMs/1000}秒`);
        safeSendMessage({
          type: 'LOG',
          data: {
            matchId: getMatchId(),
            eventType: 'supplement',
            team: team,
            teamName: teamName,
            minute: minute,
            source: 'text',
            isAlert: true,
            timestamp: new Date().toISOString(),
            url: window.location.href
          }
        });
        
        // 显示补单弹窗
        showSupplementAlert(teamName, 'possession', minute, team, pending);
      }, possessionThresholdMs);
    });
  }

  let extensionInvalid = false;

  function safeSendMessage(msg, callback) {
    if (extensionInvalid) return;
    try {
      if (callback) {
        chrome.runtime.sendMessage(msg, (response) => {
          if (chrome.runtime.lastError && chrome.runtime.lastError.message && chrome.runtime.lastError.message.includes('Extension context invalidated')) {
            console.warn('[MatchPulse] 扩展上下文已失效，跳过消息:', msg.type);
            extensionInvalid = true;
            return;
          }
          callback(response);
        });
      } else {
        chrome.runtime.sendMessage(msg);
      }
    } catch (e) {
      if (e.message && e.message.includes('Extension context invalidated')) {
        console.warn('[MatchPulse] 扩展上下文已失效，跳过消息:', msg.type);
        extensionInvalid = true;
      } else {
        console.warn('[MatchPulse] 发送消息失败:', msg.type, e);
      }
    }
  }

  function shouldAlert(minute) {
    const min = parseInt(minute) || 0;
    if (min <= 45) {
      return min >= timeSettings.firstHalfStart && min <= timeSettings.firstHalfEnd;
    } else {
      return min >= timeSettings.secondHalfStart && min <= timeSettings.secondHalfEnd;
    }
  }

  // 在主页面显示视觉报警弹窗
  function showVisualAlert(teamName, minute, team) {
    const existing = document.getElementById('mp-visual-alert');
    if (existing) existing.remove();
    const existingOverlay = document.getElementById('mp-alert-overlay');
    if (existingOverlay) existingOverlay.remove();

    const isHome = team === 'home';
    const isNeutral = team === 'neutral';
    const accentColor = isNeutral ? '#607d8b' : '#ff4757';
    const accentGlow = isNeutral ? 'rgba(96,125,139,0.4)' : 'rgba(255,71,87,0.4)';
    let position, activePosition;
    if (isNeutral) {
      position = 'left: 50%; transform: translateX(-50%) translateY(-50%) scale(0.8);';
      activePosition = 'left: 50%; transform: translateX(-50%) translateY(-50%) scale(1);';
    } else {
      position = isHome ? 'left: 16px; transform: translateY(-50%) scale(0.8);' : 'right: 16px; transform: translateY(-50%) scale(0.8);';
      activePosition = isHome ? 'left: 16px; transform: translateY(-50%) scale(1);' : 'right: 16px; transform: translateY(-50%) scale(1);';
    }

    const overlay = document.createElement('div');
    overlay.id = 'mp-alert-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:transparent;z-index:9999998;pointer-events:none;';
    document.body.appendChild(overlay);

    const alertDiv = document.createElement('div');
    alertDiv.id = 'mp-visual-alert';
    alertDiv.style.cssText = `position:fixed;top:50%;${position}z-index:9999999;background:rgba(10,15,30,0.96);color:#e0e6f0;padding:0;border-radius:12px;box-shadow:0 0 40px ${accentGlow},0 8px 32px rgba(0,0,0,0.6);text-align:center;transition:all 0.35s cubic-bezier(0.34,1.56,0.64,1);border-left:3px solid ${accentColor};overflow:hidden;min-width:220px;`;

    const teamLabel = isNeutral ? '' : (isHome ? ' (主)' : ' (客)');
    const teamDisplay = isNeutral ? '中立角球' : `${teamName}${teamLabel}`;
    const eventIcon = isNeutral ? '◇' : '◆';
    alertDiv.innerHTML = `
      <div style="background:${accentColor};padding:10px 16px;display:flex;align-items:center;justify-content:center;gap:8px;">
        <span style="font-size:16px;">${eventIcon}</span>
        <span style="font-size:15px;font-weight:700;color:#fff;letter-spacing:1px;">角球信号</span>
      </div>
      <div style="padding:14px 16px 12px;">
        <div style="font-size:13px;color:#8899aa;margin-bottom:6px;">${minute}' · ${teamDisplay}</div>
        <div style="display:flex;gap:8px;justify-content:center;margin-top:10px;">
          <button id="mp-bet-btn" style="background:${accentColor};color:#fff;border:none;padding:7px 18px;font-size:12px;font-weight:600;border-radius:6px;cursor:pointer;letter-spacing:0.5px;">标记信号</button>
          <button id="mp-close-alert" style="background:rgba(255,255,255,0.06);color:#8899aa;border:1px solid rgba(255,255,255,0.08);padding:7px 14px;font-size:12px;font-weight:500;border-radius:6px;cursor:pointer;">忽略</button>
        </div>
      </div>
    `;
    document.body.appendChild(alertDiv);

    setTimeout(() => {
      alertDiv.style.cssText = `position:fixed;top:50%;${activePosition}z-index:9999999;background:rgba(10,15,30,0.96);color:#e0e6f0;padding:0;border-radius:12px;box-shadow:0 0 40px ${accentGlow},0 8px 32px rgba(0,0,0,0.6);text-align:center;transition:all 0.35s cubic-bezier(0.34,1.56,0.64,1);border-left:3px solid ${accentColor};overflow:hidden;min-width:220px;`;
    }, 10);

    const closeBtn = document.getElementById('mp-close-alert');
    const doClose = () => {
      alertDiv.style.opacity = '0';
      alertDiv.style.transform = alertDiv.style.transform.replace('scale(1)', 'scale(0.9)');
      setTimeout(() => { alertDiv.remove(); overlay.remove(); }, 250);
    };
    if (closeBtn) closeBtn.addEventListener('click', doClose);

    // 已下注按钮事件
    const betBtn = document.getElementById('mp-bet-btn');
    if (betBtn) {
      betBtn.addEventListener('click', () => {
        const betData = {
          type: 'bet',
          matchId: getMatchId(),
          team: team,
          eventType: 'corner',
          teamName: teamName,
          minute: minute,
          timestamp: new Date().toISOString(),
          url: window.location.href
        };
        safeSendMessage({
          type: 'BET_RECORD',
          data: betData
        });
        // 设置待补单，带上当前比赛ID
        const oppositeTeam = team === 'home' ? 'away' : 'home';
        const teams = getTeamNames();
        const oppositeTeamName = team === 'home' ? teams.away : teams.home;
        const betId = Date.now();
        safeSendMessage({
          type: 'SET_PENDING_SUPPLEMENT',
          data: {
            betId: betId,
            matchId: getMatchId(),
            betTeam: team,
            betTeamName: teamName,
            oppositeTeam: oppositeTeam,
            oppositeTeamName: oppositeTeamName,
            betEventType: 'corner',
            betMinute: minute,
            betTimestamp: new Date().toISOString()
          }
        });
        betBtn.style.background = '#00e676';
        betBtn.textContent = '✓ 已标记';
        betBtn.disabled = true;
        doClose();
      });
    }

    setTimeout(doClose, 30000);
  }

  function showSupplementAlert(teamName, eventType, minute, team, betInfo) {
    const existing = document.getElementById('mp-supplement-alert');
    if (existing) existing.remove();

    const eventText = eventType === 'attack' ? '进攻' : eventType === 'possession' ? '持续控球' : '危险进攻';
    const accentColor = '#ffab00';
    const accentGlow = 'rgba(255,171,0,0.4)';
    const isHome = team === 'home';
    const betSide = betInfo.betTeam === 'home' ? '主队' : '客队';
    const position = isHome ? 'left: 16px; transform: translateY(-50%) scale(0.8);' : 'right: 16px; transform: translateY(-50%) scale(0.8);';
    const activePosition = isHome ? 'left: 16px; transform: translateY(-50%) scale(1);' : 'right: 16px; transform: translateY(-50%) scale(1);';

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
      safeSendMessage({ type: 'BET_RECORD', data: record });
      alertDiv.style.opacity = '0';
      alertDiv.style.transform = alertDiv.style.transform.replace('scale(1)', 'scale(0.9)');
      setTimeout(() => { alertDiv.remove(); }, 250);
      safeSendMessage({ type: 'CLEAR_PENDING_SUPPLEMENT' });
    });

    document.getElementById('mp-close-supplement').addEventListener('click', () => {
      alertDiv.style.opacity = '0';
      alertDiv.style.transform = alertDiv.style.transform.replace('scale(1)', 'scale(0.9)');
      setTimeout(() => { alertDiv.remove(); }, 250);
    });

    setTimeout(() => {
      if (document.getElementById('mp-supplement-alert')) {
        alertDiv.style.opacity = '0';
        alertDiv.style.transform = alertDiv.style.transform.replace('scale(1)', 'scale(0.9)');
        setTimeout(() => { alertDiv.remove(); }, 250);
      }
    }, 30000);
  }

  function showHitAlert(teamName, minute, team, betInfo) {
    const existing = document.getElementById('mp-hit-alert');
    if (existing) existing.remove();

    const isHome = team === 'home';
    const accentColor = '#ffd700';
    const accentGlow = 'rgba(255,215,0,0.5)';
    const position = isHome ? 'left: 16px; transform: translateY(-50%) scale(0.8);' : 'right: 16px; transform: translateY(-50%) scale(0.8);';
    const activePosition = isHome ? 'left: 16px; transform: translateY(-50%) scale(1);' : 'right: 16px; transform: translateY(-50%) scale(1);';

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
      setTimeout(() => { alertDiv.remove(); }, 250);
    });

    setTimeout(() => {
      if (document.getElementById('mp-hit-alert')) {
        alertDiv.style.opacity = '0';
        alertDiv.style.transform = alertDiv.style.transform.replace('scale(1)', 'scale(0.9)');
        setTimeout(() => { alertDiv.remove(); }, 250);
      }
    }, 10000);
  }

  function getTeamNames() {
    const teams = { home: '主队', away: '客队' };
    // m.leisu.com 结构
    const homeEl = document.querySelector('.match-conten .son:first-child .team-name')
      || document.querySelector('.home .team-name')
      || document.querySelector('.left-box .name');
    const awayEl = document.querySelector('.match-conten .son:last-child .team-name')
      || document.querySelector('.away .team-name')
      || document.querySelector('.right-box .name');
    if (homeEl) teams.home = homeEl.textContent.trim();
    if (awayEl) teams.away = awayEl.textContent.trim();

    // live.leisu.com 结构：.lineup .left .team .info .txt.name / .right .team .info .txt.name
    if (teams.home === '主队' || teams.away === '客队') {
      const nameEls = document.querySelectorAll('.lineup .team .info .txt.name');
      if (nameEls.length >= 2) {
        teams.home = nameEls[0].textContent.trim();
        teams.away = nameEls[1].textContent.trim();
      }
    }
    return teams;
  }

  // 从一个列表项里提取 { iconHref, text, minute }，兼容两套结构
  function extractItemInfo(item) {
    // 新结构：live.leisu.com  <li> .icon use / .time / .vs-content p
    let iconUse = item.querySelector('.icon use') || item.querySelector('.ico-box use');
    if (!iconUse) return null;
    const iconHref = iconUse.getAttribute('xlink:href') || iconUse.getAttribute('href') || '';

    // 新结构：分钟在 .time，文字在 .vs-content p
    const timeEl = item.querySelector('.time');
    const vsTextEl = item.querySelector('.vs-content p');
    // 旧结构：文字在 .broadcast-text（含分钟）
    const broadcastEl = item.querySelector('.broadcast-text');

    let text = '';
    let minute = '';

    if (timeEl && vsTextEl) {
      // 新结构
      text = vsTextEl.textContent.trim();
      const rawTime = timeEl.textContent.trim(); // "76'" 或 "45+2'"
      const mMatch = rawTime.match(/^(\d+)/);
      minute = mMatch ? mMatch[1] : '';
    } else if (broadcastEl) {
      // 旧结构
      text = broadcastEl.textContent.trim();
      const mMatch = text.match(/^(\d+)'/);
      minute = mMatch ? mMatch[1] : '';
    }

    return { iconHref, text, minute };
  }

  function getListItems() {
    let items = document.querySelectorAll('.text-live .list-son');
    if (!items.length) {
      items = document.querySelectorAll('.nav_content_area .event-list li');
    }
    return items;
  }

  // 初始化静默扫描：把页面上已有的所有角球条目加入sentEventIds，不报警
  function silentScan() {
    const items = getListItems();
    items.forEach(item => {
      const info = extractItemInfo(item);
      if (!info) return;
      if (!info.iconHref.includes('jiaoqiu')) return;
      if (!info.text.includes('角球')) return;
      const rawEventId = `corner-text-${info.text}`;
      sentEventIds.add(rawEventId);
    });
    initialized = true;
    sendDebugLog(`静默扫描完成，已记录 ${sentEventIds.size} 条历史角球`);
  }

  // 处理单条角球列表项
  function processCornerItem(item, teams) {
    const info = extractItemInfo(item);
    if (!info) return;

    const { iconHref, text, minute } = info;
    if (!iconHref.includes('jiaoqiu')) return;
    if (!text.includes('角球')) return;
    if (!minute) {
      sendDebugLog(`含角球但未匹配分钟: "${text}"`);
      return;
    }

    const rawEventId = `corner-text-${text}`;
    if (sentEventIds.has(rawEventId)) return;

    // 提取括号中的球队名
    const teamMatch = text.match(/\(([^)]+)\)/);
    const textTeamName = teamMatch ? teamMatch[1] : '';

    let teamName = '未知';
    let team = null;
    let teamSource = '';

    if (textTeamName) {
      if (teams.home && (teams.home.includes(textTeamName) || textTeamName.includes(teams.home))) {
        teamName = teams.home; team = 'home'; teamSource = '文字-主队';
      } else if (teams.away && (teams.away.includes(textTeamName) || textTeamName.includes(teams.away))) {
        teamName = teams.away; team = 'away'; teamSource = '文字-客队';
      } else {
        teamName = textTeamName; teamSource = '文字-未匹配';
        sendDebugLog(`球队名未匹配: "${textTeamName}" 主="${teams.home}" 客="${teams.away}"`);
      }
    }

    // 识别不到队伍 → 中立角球
    if (!team) {
      team = 'neutral';
      teamName = '未知';
      teamSource = '中立';
      sendDebugLog(`[${minute}'] 无法识别队伍，作为中立角球处理`);
    }

    sentEventIds.add(rawEventId);
    sendDebugLog(`[${minute}'] 球队=${teamName}(${team}) 来源=${teamSource} 文字="${text}"`);

    const eventType = team === 'neutral' ? 'neutralCorner' : 'corner';

    // 球队级冷却：同一球队同类事件15秒内只弹一次
    const cooldownKey = `${eventType}-${teamName}`;
    const cooldownUntil = cooldownMap[cooldownKey] || 0;
    if (Date.now() < cooldownUntil) {
      sendDebugLog(`[${minute}'] 冷却中: ${cooldownKey} 剩余${Math.round((cooldownUntil - Date.now()) / 1000)}s`);
      return;
    }

    if (!shouldAlert(minute)) {
      sendDebugLog(`[${minute}'] 不在时间窗口，仅记录日志`);
      safeSendMessage({
        type: 'DETECTION_LOG',
        data: { source: 'text', matchId: getMatchId(), eventType, team, teamName, teamSource, minute, url: window.location.href }
      });
      return;
    }

    safeSendMessage({
      type: 'ALERT_REQUEST',
      data: { source: 'text', matchId: getMatchId(), eventType, team, teamName, teamSource, minute, timestamp: new Date().toISOString(), url: window.location.href }
    }, (response) => {
      if (chrome.runtime.lastError) return;
      if (response && response.status === 'dedup') {
        sendDebugLog(`[${minute}'] 被去重，未报警`);
      } else {
        sendDebugLog(`[${minute}'] ★ 已报警: ${teamName}(${teamSource})`);
        cooldownMap[cooldownKey] = Date.now() + dedupWindowMs;
        showVisualAlert(teamName, minute, team);
      }
    });
  }

  function processAttackItem(item, teams) {
    // 进攻事件出现时清除所有控球计时器（球权已变化）
    Object.keys(possessionTimers).forEach(tn => clearPossessionTimer(tn));

    const info = extractItemInfo(item);
    if (!info) return;
    const { text, minute } = info;
    if (!minute) return;

    const isAttack = text.includes('进攻') || text.includes('危险进攻');
    if (!isAttack) return;

    const rawEventId = `attack-text-${text}`;
    if (sentEventIds.has(rawEventId)) return;

    const teamMatch = text.match(/\(([^)]+)\)/);
    const textTeamName = teamMatch ? teamMatch[1] : '';
    let teamName = '未知';
    let team = null;

    if (textTeamName) {
      if (teams.home && (teams.home.includes(textTeamName) || textTeamName.includes(teams.home))) {
        teamName = teams.home; team = 'home';
      } else if (teams.away && (teams.away.includes(textTeamName) || textTeamName.includes(teams.away))) {
        teamName = teams.away; team = 'away';
      }
    }
    if (!team) return;

    sentEventIds.add(rawEventId);
    const attackType = text.includes('危险进攻') ? 'dangerous_attack' : 'attack';
    sendDebugLog(`[${minute}'] 检测到${attackType}: ${teamName}(${team})`);

    // 球队级冷却：同一球队进攻事件冷却期内不重复记录
    const attackCooldownKey = `${attackType}-${teamName}`;
    const attackCooldownUntil = cooldownMap[attackCooldownKey] || 0;
    if (Date.now() < attackCooldownUntil) {
      sendDebugLog(`[${minute}'] 进攻冷却中: ${attackCooldownKey} 剩余${Math.round((attackCooldownUntil - Date.now()) / 1000)}s`);
      return;
    }
    cooldownMap[attackCooldownKey] = Date.now() + dedupWindowMs;

    // 发送进攻事件到日志
    safeSendMessage({
      type: 'DETECTION_LOG',
      data: {
        source: 'text',
        matchId: getMatchId(),
        eventType: attackType,
        team: team,
        teamName: teamName,
        minute: minute,
        url: window.location.href
      }
    });

    chrome.storage.local.get(['pendingSupplement', 'supplementMode'], (result) => {
      const pending = result.pendingSupplement;
      if (!pending) return;
      if (pending.matchId && pending.matchId !== getMatchId()) return;
      if (team !== pending.oppositeTeam) return;

      const supplementMode = result.supplementMode || 'possession';
      const isDangerous = attackType === 'dangerous_attack';
      
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
          sendDebugLog(`[${minute}'] 控球模式下${teamName}已有计时器，跳过进攻触发`);
          return;
        } else {
          sendDebugLog(`[${minute}'] 控球模式下${teamName}无活跃计时器，进攻立即触发补单`);
          shouldTrigger = true;
        }
      }

      if (!shouldTrigger) {
        sendDebugLog(`[${minute}'] 跳过补单: 当前模式${supplementMode}不触发`);
        return;
      }

      sendDebugLog(`[${minute}'] ★ 触发补单提醒: ${teamName} ${attackType}`);
      safeSendMessage({
        type: 'LOG',
        data: {
          matchId: getMatchId(),
          eventType: 'supplement',
          team: team,
          teamName: teamName,
          minute: minute,
          source: 'text',
          isAlert: true,
          timestamp: new Date().toISOString(),
          url: window.location.href
        }
      });
      showSupplementAlert(teamName, attackType, minute, team, pending);
    });
  }

  function processGoalItem(item, teams) {
    Object.keys(possessionTimers).forEach(tn => clearPossessionTimer(tn));

    const info = extractItemInfo(item);
    if (!info) return;
    const { text, minute } = info;
    if (!minute) return;

    const isGoal = text.includes('进球') || text.includes('点球');
    if (!isGoal) return;

    const rawEventId = `goal-text-${text}`;
    if (sentEventIds.has(rawEventId)) return;

    const teamMatch = text.match(/\(([^)]+)\)/);
    const textTeamName = teamMatch ? teamMatch[1] : '';
    let teamName = '未知';
    let team = null;

    if (textTeamName) {
      if (teams.home && (teams.home.includes(textTeamName) || textTeamName.includes(teams.home))) {
        teamName = teams.home; team = 'home';
      } else if (teams.away && (teams.away.includes(textTeamName) || textTeamName.includes(teams.away))) {
        teamName = teams.away; team = 'away';
      }
    }
    if (!team) return;

    sentEventIds.add(rawEventId);
    sendDebugLog(`[${minute}'] 检测到进球: ${teamName}(${team})`);

    // 球队级冷却：同一球队进球事件冷却期内不重复记录
    const goalCooldownKey = `goal-${teamName}`;
    const goalCooldownUntil = cooldownMap[goalCooldownKey] || 0;
    if (Date.now() < goalCooldownUntil) {
      sendDebugLog(`[${minute}'] 进球冷却中: ${goalCooldownKey} 剩余${Math.round((goalCooldownUntil - Date.now()) / 1000)}s`);
      return;
    }
    cooldownMap[goalCooldownKey] = Date.now() + dedupWindowMs;

    // 发送进球事件到日志
    safeSendMessage({
      type: 'DETECTION_LOG',
      data: {
        source: 'text',
        matchId: getMatchId(),
        eventType: 'goal',
        team: team,
        teamName: teamName,
        minute: minute,
        url: window.location.href
      }
    });

    chrome.storage.local.get(['pendingSupplement'], (result) => {
      const pending = result.pendingSupplement;
      if (!pending) return;
      if (pending.matchId && pending.matchId !== getMatchId()) return;
      if (team !== pending.betTeam) return;

      sendDebugLog(`[${minute}'] ★★★ 命中! ${teamName} 进球 (此前标记: ${pending.betTeamName})`);
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
      safeSendMessage({ type: 'BET_RECORD', data: hitRecord });
      showHitAlert(teamName, minute, team, pending);
      safeSendMessage({ type: 'CLEAR_PENDING_SUPPLEMENT' });
    });
  }

  function checkTextEvents() {
    if (!initialized) return;
    const textItems = getListItems();
    if (!textItems.length) return;
    const teams = getTeamNames();
    textItems.forEach(item => {
      processCornerItem(item, teams);
      processAttackItem(item, teams);
      processGoalItem(item, teams);
      processPossessionItem(item, teams);
    });
  }

  function sendTeamNames() {
    const teams = getTeamNames();
    const matchId = getMatchId();
    if ((teams.home !== '主队' || teams.away !== '客队') && matchId) {
      safeSendMessage({
        type: 'SET_TEAM_NAMES',
        data: { home: teams.home, away: teams.away, matchId: matchId }
      });
    }
  }

  // throttle 包装：300ms 内只执行一次
  function checkTextEventsThrottled() {
    if (throttleTimer) return;
    throttleTimer = setTimeout(() => {
      throttleTimer = null;
      checkTextEvents();
    }, 300);
  }

  function tryAttachObserver() {
    if (observerAttached) return;

    const targetNode = document.querySelector('.text-live')
      || document.querySelector('.nav_content_area .event-list')
      || document.querySelector('.nav_content_area');
    if (targetNode) {
      // 先静默扫描，记录已有历史条目
      silentScan();

      const observer = new MutationObserver(checkTextEventsThrottled);
      observer.observe(targetNode, { childList: true, subtree: true });
      observerAttached = true;
      sendDebugLog('MutationObserver 已绑定');
    }
  }

  function init() {
    const matchId = getMatchId();
    sendDebugLog('主页面已加载，比赛ID: ' + matchId);

    safeSendMessage({
      type: 'CONTENT_LOADED',
      data: { matchId: matchId, url: window.location.href }
    });

    // 检查是否有来自其他比赛的待补单，有则清除
    chrome.storage.local.get(['pendingSupplement'], (result) => {
      if (result.pendingSupplement && result.pendingSupplement.matchId && result.pendingSupplement.matchId !== matchId) {
        sendDebugLog(`检测到来自比赛${result.pendingSupplement.matchId}的待补单，与当前比赛${matchId}不匹配，已清除`);
        safeSendMessage({ type: 'CLEAR_PENDING_SUPPLEMENT' });
      }
    });

    loadTimeSettings();

    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === 'local') {
        if (changes.firstHalfStart || changes.firstHalfEnd || changes.secondHalfStart || changes.secondHalfEnd || changes.dedupWindowSec) {
          loadTimeSettings();
        }
      }
    });

    tryAttachObserver();
    // 定期发送队伍名称
    setInterval(sendTeamNames, 3000);
    // 如果容器还没加载，轮询重试绑定
    const retryTimer = setInterval(() => {
      if (observerAttached) {
        clearInterval(retryTimer);
        return;
      }
      tryAttachObserver();
    }, 500);
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
