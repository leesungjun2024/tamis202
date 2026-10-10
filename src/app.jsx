import React, { useState, useRef, useEffect } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { supabase } from './supabaseClient'; 

export default function App() {
  // 1. 인증(Login) 상태
  const [user, setUser] = useState(null);   
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const currentLogIdRef = useRef(null);

  // 2. 탭 관리 상태
  const [activeTab, setActiveTab] = useState('portfolio');
  const [myPortfolios, setMyPortfolios] = useState([]);
  const [currentPortfolioId, setCurrentPortfolioId] = useState(null);
  const [portfolioName, setPortfolioName] = useState('새 포트폴리오');
  const [portfolioOwnerEmail, setPortfolioOwnerEmail] = useState(''); 
  const [portfolioMembers, setPortfolioMembers] = useState([]);
  const [inviteEmail, setInviteEmail] = useState('');

  // 3. 관리자 전용 데이터 및 세분화된 대시보드 필터 상태
  const [allPortfoliosAdmin, setAllPortfoliosAdmin] = useState([]);
  const [allFeedbacksAdmin, setAllFeedbacksAdmin] = useState([]);
  const [loginLogs, setLoginLogs] = useState([]);
  
  const [dashboardFilterType, setDashboardFilterType] = useState('week'); 
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // 4. 로그인 이력 자동 리프레시 상태 ('none' | '10s' | '1m' | '5m')
  const [autoRefreshInterval, setAutoRefreshInterval] = useState('none');

  // 5. 오디오 재생 및 타임라인 상태
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // 6. 트랙 리스트
  const [tracks, setTracks] = useState([]);

  // 7. 피드백 및 댓글 상태
  const [comments, setComments] = useState([]);
  const [newCommentText, setNewCommentText] = useState('');
  const [authorName, setAuthorName] = useState('사용자');
  const [selectedTrack, setSelectedTrack] = useState('');
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);

  const wavesurferRefs = useRef({});
  const containerRefs = useRef({});
  const trackListRef = useRef(tracks);
  trackListRef.current = tracks;

  // 관리자 이메일 판별 함수
  const checkIsAdmin = (userEmail) => {
    if (!userEmail) return false;
    return userEmail === 'admin@admin.com' || userEmail.startsWith('admin') || userEmail === 'krsungjun@gmail.com';
  };

  const recordLoginLog = async (userEmail) => {
    try {
      let ip = 'Unknown IP';
      let location = '대한민국 (Seoul)';
      try {
        const ipRes = await fetch('https://api.ipify.org?format=json');
        const ipData = await ipRes.json();
        ip = ipData.ip;

        const geoRes = await fetch(`https://ipapi.co/${ip}/json/`);
        const geoData = await geoRes.json();
        if (geoData && geoData.country_name) {
          location = `${geoData.country_name} (${geoData.region || 'Unknown'})`;
        }
      } catch (e) {
        console.error('IP/위치 조회 실패:', e);
      }

      const device = navigator.userAgent;
      const currentLoginTime = new Date();
      const currentLoginTimeISO = currentLoginTime.toISOString();

      // 요청사항 반영: 동일 IP이면서 logout_time이 null인 이전 세션들을 당일 00:00:00 시간으로 업데이트
      if (ip !== 'Unknown IP') {
        const midnightToday = new Date(currentLoginTime);
        midnightToday.setHours(0, 0, 0, 0);

        const { error: updateError } = await supabase
          .from('login_logs')
          .update({ logout_time: midnightToday.toISOString() })
          .is('logout_time', null)
          .eq('ip_address', ip)
          .lt('login_time', currentLoginTimeISO);

        if (updateError) {
          console.error('이전 로그인 세션 강제 종료 업데이트 실패:', updateError.message);
        }
      }

      // 새로운 로그인 기록 삽입
      const { data, error } = await supabase
        .from('login_logs')
        .insert([{ user_email: userEmail, ip_address: ip, location: location, device: device, login_time: currentLoginTimeISO }])
        .select()
        .single();

      if (!error && data) {
        currentLogIdRef.current = data.id;
      } else if (error) {
        console.error('로그인 기록 삽입 에러:', error.message);
      }
    } catch (err) {
      console.error('로그인 기록 저장 오류:', err);
    }
  };

  const recordLogoutLog = async () => {
    if (currentLogIdRef.current) {
      await supabase
        .from('login_logs')
        .update({ logout_time: new Date().toISOString() })
        .eq('id', currentLogIdRef.current);
      currentLogIdRef.current = null;
    }
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      const currentUser = session?.user ?? null;
      if (currentUser) {
        const adminCheck = checkIsAdmin(currentUser.email);
        setIsAdmin(adminCheck);
        setUser(currentUser);
        fetchMyPortfolios(currentUser, adminCheck);
        setAuthorName(currentUser.email.split('@')[0]);

        if (event === 'SIGNED_IN') {
          await recordLoginLog(currentUser.email);
        }

        if (adminCheck) fetchAdminData();
      } else {
        setUser(null);
        setIsAdmin(false);
      }
    });

    return () => {
      subscription?.unsubscribe();
    };
  }, []);

  // 로그인 이력 자동 리프레시 타이머 설정
  useEffect(() => {
    if (activeTab !== 'admin_logs' || autoRefreshInterval === 'none') return;

    let delayMs = 10000; // 10초
    if (autoRefreshInterval === '1m') delayMs = 60000; // 1분
    if (autoRefreshInterval === '5m') delayMs = 300000; // 5분

    const timer = setInterval(() => {
      fetchAdminData();
    }, delayMs);

    return () => clearInterval(timer);
  }, [activeTab, autoRefreshInterval]);

  const handleAuth = async (e) => {
    e.preventDefault();
    if (isSignUp) {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) alert(error.message);
      else alert('회원가입 성공! 로그인해주세요.');
    } else {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        alert(error.message);
        return;
      }
    }
  };

  const handleLogout = async () => {
    await recordLogoutLog();
    await supabase.auth.signOut();
    setUser(null);
    setIsAdmin(false);
    setCurrentPortfolioId(null);
    setTracks([]);
    setComments([]);
    setPortfolioMembers([]);
    setActiveTab('portfolio');
  };

  const fetchMyPortfolios = async (userObj, adminFlag) => {
    if (!userObj) return;

    try {
      let rawPortfolios = [];

      if (adminFlag) {
        const { data, error } = await supabase
          .from('portfolios')
          .select('*')
          .order('created_at', { ascending: false });
        if (!error && data) rawPortfolios = data;
      } else {
        const { data: myOwnedData, error: myError } = await supabase
          .from('portfolios')
          .select('*')
          .eq('user_id', userObj.id);

        if (myError) throw myError;

        const { data: invitedMemberData, error: memberError } = await supabase
          .from('portfolio_members')
          .select('portfolio_id')
          .eq('member_email', userObj.email);

        if (memberError) throw memberError;

        const invitedIds = (invitedMemberData || []).map((m) => m.portfolio_id);

        let invitedPortfolios = [];
        if (invitedIds.length > 0) {
          const { data: invitedData, error: invitedError } = await supabase
            .from('portfolios')
            .select('*')
            .in('id', invitedIds);

          if (!invitedError && invitedData) {
            invitedPortfolios = invitedData;
          }
        }

        const combinedMap = new Map();
        [...(myOwnedData || []), ...invitedPortfolios].forEach((item) => {
          if (item.view_yn !== 'N') {
            combinedMap.set(item.id, item);
          }
        });

        rawPortfolios = Array.from(combinedMap.values());
      }

      const portfolioIds = rawPortfolios.map((p) => p.id);

      if (portfolioIds.length === 0) {
        setMyPortfolios([]);
        return;
      }

      const { data: membersData } = await supabase
        .from('portfolio_members')
        .select('*')
        .in('portfolio_id', portfolioIds);

      const { data: feedbacksData } = await supabase
        .from('feedbacks')
        .select('id, portfolio_id')
        .in('portfolio_id', portfolioIds);

      const finalPortfolios = rawPortfolios.map((p) => {
        const members = (membersData || []).filter((m) => m.portfolio_id === p.id);
        const feedbackCount = (feedbacksData || []).filter((f) => f.portfolio_id === p.id).length;
        const ownerEmail = (p.user_email && !p.user_email.includes('user_') && p.user_email.includes('@')) 
          ? p.user_email 
          : (userObj.email || '알 수 없음');

        return {
          ...p,
          user_email: ownerEmail,
          invited_members: members.map((m) => m.member_email),
          feedback_count: feedbackCount
        };
      }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      setMyPortfolios(finalPortfolios);
    } catch (err) {
      console.error('포트폴리오 목록 조회 오류:', err);
    }
  };

  const fetchAdminData = async () => {
    const { data: pData } = await supabase.from('portfolios').select('*').order('created_at', { ascending: false });
    const { data: mData } = await supabase.from('portfolio_members').select('*');
    const { data: tData } = await supabase.from('tracks').select('*');
    const { data: fData } = await supabase
      .from('feedbacks')
      .select('*, tracks(track_name), portfolios(portfolio_name)')
      .order('created_at', { ascending: false });
    
    // 로그인 이력 정렬: 접속 중(logout_time 없음) 우선 -> 그 다음 로그아웃 완료 건 (각 그룹 내 로그인시간 최신순)
    const { data: lData } = await supabase.from('login_logs').select('*');
    let sortedLogs = [];
    if (lData) {
      const activeLogs = lData
        .filter(l => !l.logout_time)
        .sort((a, b) => new Date(b.login_time) - new Date(a.login_time));
      
      const finishedLogs = lData
        .filter(l => l.logout_time)
        .sort((a, b) => new Date(b.login_time) - new Date(a.login_time));

      sortedLogs = [...activeLogs, ...finishedLogs];
    }

    const enhancedPortfolios = (pData || []).map(p => {
      const pMembers = (mData || []).filter(m => m.portfolio_id === p.id);
      const pTracks = (tData || []).filter(t => t.portfolio_id === p.id);
      const pFeedbacks = (fData || []).filter(f => f.portfolio_id === p.id);

      const trackDates = pTracks.map(t => new Date(t.created_at || t.updated_at || 0)).filter(d => !isNaN(d));
      const lastTrackDate = trackDates.length > 0 ? new Date(Math.max(...trackDates)) : null;

      const feedbackDates = pFeedbacks.map(f => new Date(f.updated_at || f.created_at || 0)).filter(d => !isNaN(d));
      const lastFeedbackDate = feedbackDates.length > 0 ? new Date(Math.max(...feedbackDates)) : null;

      const ownerEmail = (p.user_email && !p.user_email.includes('user_') && p.user_email.includes('@')) 
        ? p.user_email 
        : (user?.email || '알 수 없음');

      return {
        ...p,
        user_email: ownerEmail,
        member_count: 1 + pMembers.length,
        last_track_date: lastTrackDate ? lastTrackDate.toLocaleString() : '음원 없음',
        last_feedback_date: lastFeedbackDate ? lastFeedbackDate.toLocaleString() : '피드백 없음',
        owner_id: p.user_id || '알 수 없음',
        raw_members: pMembers
      };
    });

    setAllPortfoliosAdmin(enhancedPortfolios);
    setAllFeedbacksAdmin(fData || []);
    setLoginLogs(sortedLogs);
  };

  const handleToggleViewYn = async (table, id, currentVal) => {
    const nextVal = currentVal === 'N' ? 'Y' : 'N';
    const { error } = await supabase
      .from(table)
      .update({ view_yn: nextVal })
      .eq('id', id);

    if (error) {
      alert('변경 실패: ' + error.message);
    } else {
      fetchAdminData();
      if (user) fetchMyPortfolios(user, isAdmin);
    }
  };

  const handleLoadPortfolio = async (portfolio) => {
    setCurrentPortfolioId(portfolio.id);
    setPortfolioName(portfolio.portfolio_name);
    setPortfolioOwnerEmail(portfolio.user_email || user?.email || '알 수 없음');
    setActiveTab('studio');

    const { data: trackData } = await supabase
      .from('tracks')
      .select('*')
      .eq('portfolio_id', portfolio.id)
      .order('created_at', { ascending: true });

    if (trackData && trackData.length > 0) {
      setTracks(trackData);
      setSelectedTrack(trackData[0].id);
    } else {
      setTracks([]);
      setSelectedTrack('');
    }

    const { data: feedbackData } = await supabase
      .from('feedbacks')
      .select(`*, tracks (track_name)`)
      .eq('portfolio_id', portfolio.id);

    if (feedbackData) {
      const filtered = isAdmin ? feedbackData : feedbackData.filter(f => f.view_yn !== 'N');
      const sorted = filtered.sort((a, b) => (a.start_time || 0) - (b.start_time || 0));
      setComments(sorted);
    } else {
      setComments([]);
    }

    const { data: memberData } = await supabase
      .from('portfolio_members')
      .select('*')
      .eq('portfolio_id', portfolio.id);

    setPortfolioMembers(memberData || []);
  };

  const handleCreatePortfolio = async () => {
    if (!user) return;
    const title = prompt('새 포트폴리오 이름을 입력하세요:', '나의 새 포트폴리오');
    if (!title) return;

    const { data, error } = await supabase
      .from('portfolios')
      .insert([
        { 
          portfolio_name: title, 
          user_id: user.id, 
          user_email: user.email, 
          view_yn: 'Y' 
        }
      ])
      .select()
      .single();

    if (error) {
      alert('포트폴리오 생성 실패: ' + error.message);
    } else {
      fetchMyPortfolios(user, isAdmin);
      handleLoadPortfolio(data);
    }
  };

  const handleInviteMember = async (e) => {
    e.preventDefault();
    const trimmedEmail = inviteEmail.trim();
    if (!trimmedEmail || !currentPortfolioId) return;

    if (trimmedEmail.toLowerCase() === portfolioOwnerEmail.toLowerCase()) {
      alert(`이미 초대 된 사용자(${trimmedEmail}) 입니다.`);
      setInviteEmail('');
      return;
    }

    const { data: dbMembers, error: dbError } = await supabase
      .from('portfolio_members')
      .select('member_email')
      .eq('portfolio_id', currentPortfolioId);

    if (dbError) {
      alert('초대 목록 조회 중 오류가 발생했습니다.');
      return;
    }

    const isAlreadyMember = (dbMembers || []).some(
      (m) => m.member_email && m.member_email.toLowerCase() === trimmedEmail.toLowerCase()
    );

    if (isAlreadyMember) {
      alert(`이미 초대 된 사용자(${trimmedEmail}) 입니다.`);
      setInviteEmail('');
      return;
    }

    const { error: insertError } = await supabase
      .from('portfolio_members')
      .insert([{ portfolio_id: currentPortfolioId, member_email: trimmedEmail, role: 'editor' }]);

    if (insertError) {
      if (insertError.code === '23505') {
        alert(`이미 초대 된 사용자(${trimmedEmail}) 입니다.`);
      } else {
        alert('사용자 초대 실패: ' + insertError.message);
      }
    } else {
      alert(`${trimmedEmail} 님을 초대했습니다!`);
      setInviteEmail('');
      
      const { data: refreshedMembers } = await supabase
        .from('portfolio_members')
        .select('*')
        .eq('portfolio_id', currentPortfolioId);
      setPortfolioMembers(refreshedMembers || []);
      fetchMyPortfolios(user, isAdmin);
    }
  };

  useEffect(() => {
    if (!currentPortfolioId || tracks.length === 0) return;
    let isMounted = true;
    const sortedTracks = [...tracks].sort((a, b) => (a.order || 0) - (b.order || 0));

    sortedTracks.forEach((track) => {
      const container = containerRefs.current[track.id];
      if (!container) return;

      if (wavesurferRefs.current[track.id]) {
        wavesurferRefs.current[track.id].destroy();
      }

      const ws = WaveSurfer.create({
        container: container,
        url: track.file_url,
        waveColor: '#cbd5e1',
        progressColor: '#6366f1',
        cursorColor: '#4f46e5',
        height: 48,
        mediaControls: false,
        xhr: { cache: 'default', mode: 'cors' }
      });

      wavesurferRefs.current[track.id] = ws;

      ws.on('ready', () => {
        if (!isMounted) return;
        const dur = ws.getDuration();
        if (dur > duration) setDuration(dur);
      });

      ws.on('audioprocess', () => {
        if (!isMounted) return;
        if (track.id === trackListRef.current[0]?.id) {
          setCurrentTime(ws.getCurrentTime());
        }
      });

      ws.on('interaction', () => {
        if (!isMounted) return;
        const clickedTime = ws.getCurrentTime();
        setCurrentTime(clickedTime);
        setStartTime(Number(clickedTime.toFixed(2)));
        setEndTime(Number(clickedTime.toFixed(2)));
        setSelectedTrack(track.id);
      });
    });

    return () => {
      isMounted = false;
      Object.values(wavesurferRefs.current).forEach((ws) => ws?.destroy());
    };
  }, [tracks, currentPortfolioId]);

  const handleMasterPlayPause = () => {
    const nextState = !isPlaying;
    setIsPlaying(nextState);

    Object.values(wavesurferRefs.current).forEach((ws) => {
      if (ws) {
        if (nextState) ws.play();
        else ws.pause();
      }
    });
  };

  const handleToggleMute = (trackId) => {
    setTracks((prev) =>
      prev.map((t) => {
        if (t.id === trackId) {
          const newMuted = !t.muted;
          const ws = wavesurferRefs.current[trackId];
          if (ws) ws.setMuted(newMuted);
          return { ...t, muted: newMuted };
        }
        return t;
      })
    );
  };

  const handleMultipleUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0 || !currentPortfolioId) {
      alert('포트폴리오를 먼저 열어주세요!');
      return;
    }

    const corsSafeUrls = [
      'https://www.w3schools.com/html/horse.mp3',
      'https://actions.google.com/sounds/v1/ambiences/rain_heavy.ogg',
      'https://www.w3schools.com/html/horse.ogg'
    ];

    const newTracksPayload = files.map((file, idx) => ({
      portfolio_id: currentPortfolioId,
      track_name: file.name,
      file_url: corsSafeUrls[idx % corsSafeUrls.length],
      uploader_type: 'mine',
      order: tracks.length + idx + 1
    }));

    const { data, error } = await supabase.from('tracks').insert(newTracksPayload).select();

    if (error) {
      alert('음원 저장 중 오류가 발생했습니다.');
    } else {
      setTracks((prev) => [...prev, ...data]);
      if (!selectedTrack && data.length > 0) setSelectedTrack(data[0].id);
      alert(`${files.length}개의 음원이 추가되었습니다.`);
    }
  };

  const handleAddComment = async (e) => {
    e.preventDefault();
    if (!newCommentText.trim() || !currentPortfolioId) {
      alert('포트폴리오를 열고 의견을 남겨주세요.');
      return;
    }

    const newComment = {
      portfolio_id: currentPortfolioId,
      user_id: user.id,
      author: authorName,
      track_id: selectedTrack,
      start_time: Number(Number(startTime).toFixed(2)),
      end_time: Number(Number(endTime).toFixed(2)),
      content: newCommentText,
      view_yn: 'Y'
    };

    const { data, error } = await supabase.from('feedbacks').insert([newComment]).select();

    if (error) {
      alert('피드백 저장 중 오류 발생');
    } else {
      if (data && data.length > 0) {
        const targetTrack = tracks.find((t) => t.id === selectedTrack);
        const commentWithTrack = {
          ...data[0],
          tracks: { track_name: targetTrack ? targetTrack.track_name : '알 수 없는 음원' }
        };

        setComments((prev) => [...prev, commentWithTrack].sort((a, b) => a.start_time - b.start_time));
        fetchMyPortfolios(user, isAdmin);
      }
      setNewCommentText('');
    }
  };

  const handleSeek = (seconds) => {
    Object.values(wavesurferRefs.current).forEach((ws) => {
      if (ws) ws.setTime(seconds);
    });
    setCurrentTime(seconds);
  };

  const formatTime = (secs) => {
    if (isNaN(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const filterByDashboardRange = (itemList, dateField) => {
    const now = new Date();
    return itemList.filter(item => {
      if (!item[dateField]) return false;
      const itemDate = new Date(item[dateField]);

      if (dashboardFilterType === 'today') {
        return itemDate.toDateString() === now.toDateString();
      } else if (dashboardFilterType === 'yesterday') {
        const yest = new Date();
        yest.setDate(now.getDate() - 1);
        return itemDate.toDateString() === yest.toDateString();
      } else if (dashboardFilterType === 'week') {
        const diffDays = (now - itemDate) / (1000 * 60 * 60 * 24);
        return diffDays >= 0 && diffDays <= 7;
      } else if (dashboardFilterType === 'month') {
        const diffDays = (now - itemDate) / (1000 * 60 * 60 * 24);
        return diffDays >= 0 && diffDays <= 30;
      } else if (dashboardFilterType === 'custom' && fromDate && toDate) {
        const fDate = new Date(fromDate);
        const tDate = new Date(toDate);
        tDate.setHours(23, 59, 59, 999);
        return itemDate >= fDate && itemDate <= tDate;
      }
      return true;
    });
  };

  const filteredPortfolios = filterByDashboardRange(allPortfoliosAdmin, 'created_at');
  const filteredFeedbacks = filterByDashboardRange(allFeedbacksAdmin, 'created_at');
  const filteredLogs = filterByDashboardRange(loginLogs, 'login_time');

  const generateTimeSeriesStats = () => {
    const now = new Date();
    let slots = [];

    if (dashboardFilterType === 'today' || dashboardFilterType === 'yesterday') {
      const targetDay = new Date();
      if (dashboardFilterType === 'yesterday') targetDay.setDate(now.getDate() - 1);
      
      for (let h = 0; h < 24; h++) {
        const label = `${h.toString().padStart(2, '0')}시`;
        slots.push({ key: label, label, pCount: 0, mCount: 0, fCount: 0, rawDate: new Date(targetDay.getFullYear(), targetDay.getMonth(), targetDay.getDate(), h) });
      }

      filteredPortfolios.forEach(p => {
        const d = new Date(p.created_at);
        if (d.toDateString() === targetDay.toDateString()) {
          const h = d.getHours();
          if (slots[h]) { slots[h].pCount += 1; slots[h].mCount += (p.member_count || 1); }
        }
      });
      filteredFeedbacks.forEach(f => {
        const d = new Date(f.created_at);
        if (d.toDateString() === targetDay.toDateString()) {
          const h = d.getHours();
          if (slots[h]) slots[h].fCount += 1;
        }
      });
    } else {
      let daysCount = 7;
      let startDate = new Date();

      if (dashboardFilterType === 'month') {
        daysCount = 31;
      } else if (dashboardFilterType === 'custom' && fromDate && toDate) {
        const f = new Date(fromDate);
        const t = new Date(toDate);
        const diff = Math.ceil((t - f) / (1000 * 60 * 60 * 24)) + 1;
        daysCount = Math.max(7, Math.min(31, diff));
        startDate = new Date(t);
      }

      for (let i = daysCount - 1; i >= 0; i--) {
        const d = new Date(startDate);
        d.setDate(startDate.getDate() - i);
        const label = `${d.getMonth() + 1}/${d.getDate()}`;
        slots.push({ key: label, label, pCount: 0, mCount: 0, fCount: 0, targetDateStr: d.toDateString() });
      }

      filteredPortfolios.forEach(p => {
        const d = new Date(p.created_at);
        const slot = slots.find(s => s.targetDateStr === d.toDateString());
        if (slot) { slot.pCount += 1; slot.mCount += (p.member_count || 1); }
      });
      filteredFeedbacks.forEach(f => {
        const d = new Date(f.created_at);
        const slot = slots.find(s => s.targetDateStr === d.toDateString());
        if (slot) slot.fCount += 1;
      });
    }

    return slots;
  };

  const timeSeriesData = generateTimeSeriesStats();
  const maxTimeSeriesVal = Math.max(...timeSeriesData.map(s => Math.max(s.pCount, s.mCount, s.fCount)), 1);

  const sortedTracks = [...tracks].sort((a, b) => (a.order || 0) - (b.order || 0));

  if (!user) {
    return (
      <div style={{ maxWidth: '400px', margin: '80px auto', padding: '30px', background: '#fff', borderRadius: '16px', boxShadow: '0 4px 20px rgba(0,0,0,0.08)', fontFamily: 'sans-serif' }}>
        <h2 style={{ textAlign: 'center', marginBottom: '20px', color: '#1e293b' }}>🎵 멀티트랙 포트폴리오 로그인</h2>
        <form onSubmit={handleAuth} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <input type="email" placeholder="이메일 입력" value={email} onChange={(e) => setEmail(e.target.value)} style={{ padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1' }} required />
          <input type="password" placeholder="비밀번호 입력" value={password} onChange={(e) => setPassword(e.target.value)} style={{ padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1' }} required />
          <button type="submit" style={{ padding: '10px', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}>
            {isSignUp ? '회원가입 하기' : '로그인 하기'}
          </button>
        </form>
        <p onClick={() => setIsSignUp(!isSignUp)} style={{ textAlign: 'center', marginTop: '15px', fontSize: '13px', color: '#6366f1', cursor: 'pointer' }}>
          {isSignUp ? '이미 계정이 있으신가요? 로그인' : '계정이 없으신가요? 회원가입'}
        </p>
      </div>
    );
  }

  const isOwner = user.email === portfolioOwnerEmail;

  return (
    <div style={{ maxWidth: '1050px', margin: '30px auto', padding: '24px', background: '#fff', borderRadius: '16px', boxShadow: '0 4px 20px rgba(0,0,0,0.08)', fontFamily: 'sans-serif' }}>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', padding: '12px 16px', background: '#f8fafc', borderRadius: '10px', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#4f46e5' }}>👤 {user.email}</span> 
          {isAdmin && <span style={{ marginLeft: '6px', background: '#ef4444', color: '#fff', padding: '2px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold' }}>👑 관리자</span>}
          님 접속중
        </div>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <button onClick={() => { setActiveTab('portfolio'); fetchMyPortfolios(user, isAdmin); }} style={{ padding: '6px 10px', background: activeTab === 'portfolio' ? '#4f46e5' : '#e2e8f0', color: activeTab === 'portfolio' ? '#fff' : '#334155', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}>
            📁 포트폴리오 목록
          </button>
          <button onClick={() => {
            if (!currentPortfolioId) {
              alert('열려있는 포트폴리오가 없습니다.');
              return;
            }
            setActiveTab('studio');
          }} style={{ padding: '6px 10px', background: activeTab === 'studio' ? '#4f46e5' : '#e2e8f0', color: activeTab === 'studio' ? '#fff' : '#334155', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}>
            🎛️ 스튜디오
          </button>
          
          {isAdmin && (
            <>
              <button onClick={() => { setActiveTab('admin_dashboard'); fetchAdminData(); }} style={{ padding: '6px 10px', background: activeTab === 'admin_dashboard' ? '#0f172a' : '#e2e8f0', color: activeTab === 'admin_dashboard' ? '#fff' : '#334155', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}>
                📊 대시보드
              </button>
              <button onClick={() => { setActiveTab('admin_management'); fetchAdminData(); }} style={{ padding: '6px 10px', background: activeTab === 'admin_management' ? '#0f172a' : '#e2e8f0', color: activeTab === 'admin_management' ? '#fff' : '#334155', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}>
                ⚙️ 관리 페이지
              </button>
              <button onClick={() => { setActiveTab('admin_logs'); fetchAdminData(); }} style={{ padding: '6px 10px', background: activeTab === 'admin_logs' ? '#0f172a' : '#e2e8f0', color: activeTab === 'admin_logs' ? '#fff' : '#334155', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}>
                📋 로그인 이력
              </button>
            </>
          )}

          <button onClick={handleLogout} style={{ padding: '6px 10px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}>
            로그아웃
          </button>
        </div>
      </div>

      {activeTab === 'admin_dashboard' && isAdmin ? (
        <div style={{ padding: '10px 0' }}>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px', background: '#f8fafc', padding: '12px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 'bold', color: '#1e293b', margin: 0 }}>📊 관리자 대시보드 상세 통계</h2>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
              <button onClick={() => setDashboardFilterType('today')} style={{ padding: '6px 10px', background: dashboardFilterType === 'today' ? '#4f46e5' : '#fff', color: dashboardFilterType === 'today' ? '#fff' : '#475569', border: '1px solid #cbd5e1', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '11px' }}>금일</button>
              <button onClick={() => setDashboardFilterType('yesterday')} style={{ padding: '6px 10px', background: dashboardFilterType === 'yesterday' ? '#4f46e5' : '#fff', color: dashboardFilterType === 'yesterday' ? '#fff' : '#475569', border: '1px solid #cbd5e1', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '11px' }}>어제</button>
              <button onClick={() => setDashboardFilterType('week')} style={{ padding: '6px 10px', background: dashboardFilterType === 'week' ? '#4f46e5' : '#fff', color: dashboardFilterType === 'week' ? '#fff' : '#475569', border: '1px solid #cbd5e1', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '11px' }}>최근 일주일</button>
              <button onClick={() => setDashboardFilterType('month')} style={{ padding: '6px 10px', background: dashboardFilterType === 'month' ? '#4f46e5' : '#fff', color: dashboardFilterType === 'month' ? '#fff' : '#475569', border: '1px solid #cbd5e1', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '11px' }}>최근 한달</button>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: '6px' }}>
                <input type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); setDashboardFilterType('custom'); }} style={{ padding: '4px', fontSize: '11px', borderRadius: '4px', border: '1px solid #cbd5e1' }} />
                <span style={{ fontSize: '11px' }}>~</span>
                <input type="date" value={toDate} onChange={(e) => { setToDate(e.target.value); setDashboardFilterType('custom'); }} style={{ padding: '4px', fontSize: '11px', borderRadius: '4px', border: '1px solid #cbd5e1' }} />
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '24px' }}>
            <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
              <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 'bold' }}>포트폴리오 (기간내 / 전체)</div>
              <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#4f46e5', marginTop: '6px' }}>
                {filteredPortfolios.length} 개 <span style={{ fontSize: '13px', color: '#94a3b8' }}>/ {allPortfoliosAdmin.length} 개</span>
              </div>
            </div>
            <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
              <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 'bold' }}>피드백 (기간내 / 전체)</div>
              <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#10b981', marginTop: '6px' }}>
                {filteredFeedbacks.length} 건 <span style={{ fontSize: '13px', color: '#94a3b8' }}>/ {allFeedbacksAdmin.length} 건</span>
              </div>
            </div>
            <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
              <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 'bold' }}>로그인 이력 (기간내 / 전체)</div>
              <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#f59e0b', marginTop: '6px' }}>
                {filteredLogs.length} 건 <span style={{ fontSize: '13px', color: '#94a3b8' }}>/ {loginLogs.length} 건</span>
              </div>
            </div>
          </div>

          <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', marginBottom: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 'bold', color: '#334155', margin: 0 }}>📈 1. 시계열 현황 (포트폴리오 / 회원수 / 피드백수)</h3>
              <div style={{ fontSize: '11px', color: '#475569', background: '#fff', padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
                🔵 포트폴리오 | 🟢 회원수 | 🟠 피드백
              </div>
            </div>

            <div style={{ height: '200px', display: 'flex', alignItems: 'flex-end', gap: '8px', paddingBottom: '24px', borderBottom: '1px solid #cbd5e1', paddingLeft: '8px', paddingRight: '8px', overflowX: 'auto' }}>
              {timeSeriesData.length === 0 ? (
                <div style={{ width: '100%', textAlign: 'center', color: '#94a3b8', lineHeight: '170px' }}>데이터가 없습니다.</div>
              ) : (
                timeSeriesData.map((stat, idx) => {
                  const pHeight = Math.round((stat.pCount / maxTimeSeriesVal) * 120);
                  const mHeight = Math.round((stat.mCount / maxTimeSeriesVal) * 120);
                  const fHeight = Math.round((stat.fCount / maxTimeSeriesVal) * 120);

                  return (
                    <div key={idx} style={{ flex: 1, minWidth: '32px', display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end' }}>
                      <div style={{ fontSize: '8px', color: '#334155', marginBottom: '2px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        {stat.pCount}/{stat.mCount}/{stat.fCount}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', width: '100%', height: '130px', justifyContent: 'center' }}>
                        <div style={{ width: '28%', background: '#4f46e5', height: `${Math.max(pHeight, 4)}px`, borderRadius: '2px 2px 0 0' }} title={`포트폴리오: ${stat.pCount}`} />
                        <div style={{ width: '28%', background: '#10b981', height: `${Math.max(mHeight, 4)}px`, borderRadius: '2px 2px 0 0' }} title={`회원수: ${stat.mCount}`} />
                        <div style={{ width: '28%', background: '#f59e0b', height: `${Math.max(fHeight, 4)}px`, borderRadius: '2px 2px 0 0' }} title={`피드백: ${stat.fCount}`} />
                      </div>
                      <span style={{ fontSize: '9px', color: '#475569', marginTop: '6px', whiteSpace: 'nowrap' }}>{stat.label}</span>
                    </div>
                  );
                })
              )}
            </div>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '8px', textAlign: 'center' }}>
              * 선택하신 기간 조건에 맞추어 시계열(시간대 또는 일자별) 3가지 지표(포트폴리오 수 / 회원수 / 피드백 수)가 표출됩니다.
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '12px', color: '#334155' }}>🎵 2. 콘텐츠 및 피드백 지표</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                  <span>기간 내 포트폴리오 수</span><strong style={{ color: '#4f46e5' }}>{filteredPortfolios.length} 개</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                  <span>기간 내 피드백 수</span><strong style={{ color: '#10b981' }}>{filteredFeedbacks.length} 건</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                  <span>기간 내 피드백 회원수</span><strong style={{ color: '#f59e0b' }}>{new Set(filteredFeedbacks.map(f => f.author)).size} 명</strong>
                </div>
              </div>
            </div>

            <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '12px', color: '#334155' }}>🌍 3. 로그인 지역 및 회원 분포</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px' }}>
                {Object.entries(
                  filteredLogs.reduce((acc, log) => {
                    const loc = log.location || '대한민국 (Seoul)';
                    acc[loc] = (acc[loc] || 0) + 1;
                    return acc;
                  }, {})
                ).map(([location, count], idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                    <span>📍 {location}</span><span style={{ background: '#e0e7ff', color: '#3730a3', padding: '2px 8px', borderRadius: '4px', fontWeight: 'bold' }}>{count} 명</span>
                  </div>
                ))}
                {filteredLogs.length === 0 && <div style={{ textAlign: 'center', color: '#94a3b8', padding: '20px' }}>데이터 없음</div>}
              </div>
            </div>
          </div>
        </div>
      ) : activeTab === 'admin_management' && isAdmin ? (
        <div style={{ padding: '10px 0' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '16px', color: '#1e293b' }}>⚙️ 관리 페이지 (조회/사용 여부 및 상세 정보 관리)</h2>

          <div style={{ marginBottom: '28px', background: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '12px', color: '#334155' }}>📁 포트폴리오 사용(조회) 여부 및 상세 관리</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                <thead>
                  <tr style={{ background: '#e2e8f0', textAlign: 'left' }}>
                    <th style={{ padding: '8px' }}>포트폴리오 명</th>
                    <th style={{ padding: '8px' }}>이메일 (소유자)</th>
                    <th style={{ padding: '8px' }}>회원수</th>
                    <th style={{ padding: '8px' }}>최종 음원 조회일자</th>
                    <th style={{ padding: '8px' }}>최종 피드백 수정일자</th>
                    <th style={{ padding: '8px' }}>사용 여부</th>
                    <th style={{ padding: '8px' }}>소유자 ID</th>
                  </tr>
                </thead>
                <tbody>
                  {allPortfoliosAdmin.map((p) => (
                    <tr key={p.id} style={{ borderBottom: '1px solid #cbd5e1' }}>
                      <td style={{ padding: '8px', fontWeight: 'bold' }}>{p.portfolio_name}</td>
                      <td style={{ padding: '8px', color: '#4f46e5', fontWeight: 'bold' }}>{p.user_email}</td>
                      <td style={{ padding: '8px', textAlign: 'center' }}>{p.member_count} 명</td>
                      <td style={{ padding: '8px' }}>{p.last_track_date}</td>
                      <td style={{ padding: '8px' }}>{p.last_feedback_date}</td>
                      <td style={{ padding: '8px' }}>
                        <button onClick={() => handleToggleViewYn('portfolios', p.id, p.view_yn || 'Y')} style={{ padding: '4px 8px', background: (p.view_yn || 'Y') !== 'N' ? '#10b981' : '#ef4444', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>
                          {(p.view_yn || 'Y') !== 'N' ? 'Y (사용 중)' : 'N (중지됨)'}
                        </button>
                      </td>
                      <td style={{ padding: '8px', fontFamily: 'monospace', fontSize: '10px' }}>{p.owner_id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '12px', color: '#334155' }}>💬 피드백 사용(조회) 여부 및 상세 관리</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                <thead>
                  <tr style={{ background: '#e2e8f0', textAlign: 'left' }}>
                    <th style={{ padding: '8px' }}>포트폴리오</th>
                    <th style={{ padding: '8px' }}>음원명</th>
                    <th style={{ padding: '8px' }}>작성자</th>
                    <th style={{ padding: '8px' }}>내용</th>
                    <th style={{ padding: '8px' }}>등록일자</th>
                    <th style={{ padding: '8px' }}>사용 여부</th>
                  </tr>
                </thead>
                <tbody>
                  {allFeedbacksAdmin.map((f) => (
                    <tr key={f.id} style={{ borderBottom: '1px solid #cbd5e1' }}>
                      <td style={{ padding: '8px' }}>{f.portfolios?.portfolio_name || '알 수 없음'}</td>
                      <td style={{ padding: '8px', fontWeight: 'bold', color: '#4f46e5' }}>{f.tracks?.track_name || '음원 정보 없음'}</td>
                      <td style={{ padding: '8px' }}>{f.author}</td>
                      <td style={{ padding: '8px' }}>{f.content}</td>
                      <td style={{ padding: '8px' }}>{f.created_at ? new Date(f.created_at).toLocaleString() : '-'}</td>
                      <td style={{ padding: '8px' }}>
                        <button onClick={() => handleToggleViewYn('feedbacks', f.id, f.view_yn || 'Y')} style={{ padding: '4px 8px', background: (f.view_yn || 'Y') !== 'N' ? '#10b981' : '#ef4444', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>
                          {(f.view_yn || 'Y') !== 'N' ? 'Y (사용 중)' : 'N (중지됨)'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : activeTab === 'admin_logs' && isAdmin ? (
        <div style={{ padding: '10px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 'bold', color: '#1e293b', margin: 0 }}>📋 사용자 로그인 이력 조회</h2>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={fetchAdminData} style={{ padding: '5px 10px', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}>
                🔄 리프레시
              </button>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '12px', color: '#475569' }}>
                <span>자동 리프레시:</span>
                <label style={{ cursor: 'pointer' }}>
                  <input type="checkbox" checked={autoRefreshInterval === '10s'} onChange={(e) => setAutoRefreshInterval(e.target.checked ? '10s' : 'none')} /> 10초
                </label>
                <label style={{ cursor: 'pointer' }}>
                  <input type="checkbox" checked={autoRefreshInterval === '1m'} onChange={(e) => setAutoRefreshInterval(e.target.checked ? '1m' : 'none')} /> 1분
                </label>
                <label style={{ cursor: 'pointer' }}>
                  <input type="checkbox" checked={autoRefreshInterval === '5m'} onChange={(e) => setAutoRefreshInterval(e.target.checked ? '5m' : 'none')} /> 5분
                </label>
              </div>
            </div>
          </div>

          <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{ background: '#e2e8f0', textAlign: 'left' }}>
                  <th style={{ padding: '8px' }}>사용자 이메일</th>
                  <th style={{ padding: '8px' }}>접속 IP</th>
                  <th style={{ padding: '8px' }}>지역/국가</th>
                  <th style={{ padding: '8px' }}>로그인 시간</th>
                  <th style={{ padding: '8px' }}>로그아웃 시간</th>
                  <th style={{ padding: '8px' }}>접속 매체</th>
                </tr>
              </thead>
              <tbody>
                {loginLogs.length === 0 ? (
                  <tr><td colSpan="6" style={{ textAlign: 'center', padding: '20px', color: '#64748b' }}>기록된 로그인 이력이 없습니다.</td></tr>
                ) : (
                  loginLogs.map((log) => (
                    <tr key={log.id} style={{ borderBottom: '1px solid #cbd5e1' }}>
                      <td style={{ padding: '8px', fontWeight: 'bold' }}>{log.user_email}</td>
                      <td style={{ padding: '8px' }}>{log.ip_address || '-'}</td>
                      <td style={{ padding: '8px' }}>{log.location || '대한민국 (Seoul)'}</td>
                      <td style={{ padding: '8px' }}>{log.login_time ? new Date(log.login_time).toLocaleString() : '-'}</td>
                      <td style={{ padding: '8px' }}>{log.logout_time ? new Date(log.logout_time).toLocaleString() : '접속 중'}</td>
                      <td style={{ padding: '8px', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={log.device}>{log.device || '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : activeTab === 'portfolio' ? (
        <div style={{ padding: '20px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h2 style={{ fontSize: '20px', fontWeight: 'bold', color: '#1e293b', margin: 0 }}>📁 포트폴리오 목록</h2>
            <button onClick={handleCreatePortfolio} style={{ padding: '8px 14px', background: '#10b981', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px' }}>
              ➕ 새 포트폴리오 만들기
            </button>
          </div>

          {myPortfolios.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#64748b', padding: '40px', background: '#f8fafc', borderRadius: '10px' }}>
              생성된 포트폴리오가 없습니다.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {myPortfolios.map((p) => (
                <div key={p.id} style={{ padding: '18px', background: '#f1f5f9', borderRadius: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #e2e8f0' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontWeight: 'bold', color: '#1e293b', fontSize: '17px' }}>{p.portfolio_name}</span>
                      <span style={{ fontSize: '11px', background: '#e0e7ff', color: '#3730a3', padding: '2px 8px', borderRadius: '12px', fontWeight: 'bold' }}>
                        💬 피드백 {p.feedback_count || 0}개
                      </span>
                    </div>

                    <div style={{ fontSize: '12px', color: '#475569', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 'bold', color: '#1e293b' }}>👑 소유자:</span>
                      <span style={{ color: '#4f46e5', fontWeight: 'bold' }}>{p.user_email}</span>
                      <span style={{ color: '#cbd5e1' }}>|</span>
                      <span style={{ fontSize: '11px', color: '#94a3b8' }}>생성일: {new Date(p.created_at).toLocaleDateString()}</span>
                    </div>

                    <div style={{ fontSize: '12px', color: '#475569', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginTop: '2px' }}>
                      <span style={{ fontWeight: 'bold', color: '#1e293b' }}>👥 초대된 멤버:</span>
                      {p.invited_members && p.invited_members.length > 0 ? (
                        p.invited_members.map((mEmail, idx) => (
                          <span key={idx} style={{ background: '#fff', border: '1px solid #cbd5e1', padding: '1px 6px', borderRadius: '4px', fontSize: '11px', color: '#334155' }}>
                            {mEmail}
                          </span>
                        ))
                      ) : (
                        <span style={{ color: '#94a3b8', fontSize: '11px' }}>초대된 멤버 없음</span>
                      )}
                    </div>
                  </div>

                  <button onClick={() => handleLoadPortfolio(p)} style={{ padding: '10px 16px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px', whiteSpace: 'nowrap' }}>
                    📂 포트폴리오 열기 (스튜디오 진입)
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div style={{ padding: '10px 0' }}>
          <div style={{ marginBottom: '20px', padding: '16px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '10px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 'bold', color: '#1e293b', margin: 0 }}>
                🎵 현재 포트폴리오: <span style={{ color: '#4f46e5' }}>{portfolioName} ({portfolioOwnerEmail})</span>
              </h2>
              <label style={{ padding: '6px 12px', background: '#3b82f6', color: '#fff', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px', display: 'inline-block' }}>
                📁 음원 추가하기 (CORS 안전 샘플)
                <input type="file" multiple accept="audio/*" onChange={handleMultipleUpload} style={{ display: 'none' }} />
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #e2e8f0', paddingTop: '12px', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#334155', marginRight: '8px' }}>👥 팀원 접속현황:</span>
                
                <span style={{ fontSize: '12px', background: '#dbeafe', color: '#1e40af', padding: '3px 8px', borderRadius: '6px', marginRight: '6px', fontWeight: 'bold', border: '1px solid #3b82f6' }}>
                  🟢 {user.email} ({isOwner ? '소유자' : 'editor'})
                </span>

                {portfolioMembers.map((m) => {
                  if (m.member_email === user.email) return null;
                  return (
                    <span 
                      key={m.id} 
                      style={{ 
                        fontSize: '12px', 
                        background: '#f1f5f9', 
                        color: '#94a3b8', 
                        padding: '3px 8px', 
                        borderRadius: '6px', 
                        marginRight: '6px',
                        border: '1px solid #cbd5e1'
                      }}
                      title="미접속"
                    >
                      ⚪ {m.member_email} ({m.role || 'editor'})
                    </span>
                  );
                })}
              </div>

              <form onSubmit={handleInviteMember} style={{ display: 'flex', gap: '6px' }}>
                <input type="email" placeholder="초대할 팀원 이메일" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} style={{ padding: '6px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12px' }} required />
                <button type="submit" style={{ padding: '6px 10px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', fontWeight: 'bold' }}>
                  사용자 초대
                </button>
              </form>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', padding: '12px 18px', background: '#f1f5f9', borderRadius: '12px' }}>
            <button onClick={handleMasterPlayPause} style={{ padding: '10px 16px', background: isPlaying ? '#ef4444' : '#6366f1', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px' }}>
              {isPlaying ? '⏸ 전체 일시정지' : '▶ 전체 동시 재생'}
            </button>
            <span style={{ fontFamily: 'monospace', fontSize: '16px', fontWeight: 'bold', color: '#333' }}>
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '30px' }}>
            {sortedTracks.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#94a3b8', padding: '30px', background: '#fafafa', borderRadius: '8px' }}>
                등록된 음원이 없습니다.
              </div>
            ) : (
              sortedTracks.map((track) => (
                <div key={track.id} style={{ padding: '14px', background: '#fafafa', borderRadius: '12px', border: '1px solid #e5e7eb' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '12px', fontWeight: 'bold', background: '#dbeafe', color: '#1e40af', padding: '2px 6px', borderRadius: '4px' }}>음원</span>
                      <span style={{ fontSize: '15px', fontWeight: 'bold', color: '#222' }}>{track.track_name}</span>
                    </div>
                    <button onClick={() => handleToggleMute(track.id)} style={{ padding: '4px 10px', background: track.muted ? '#ef4444' : '#e5e7eb', color: track.muted ? '#fff' : '#374151', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', fontWeight: 'bold' }}>
                      {track.muted ? '🔇 음소거 해제' : '🔊 음소거'}
                    </button>
                  </div>
                  <div ref={(el) => (containerRefs.current[track.id] = el)} style={{ width: '100%', background: '#fff', borderRadius: '6px', overflow: 'hidden' }} />
                </div>
              ))
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div style={{ padding: '16px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '12px', color: '#1e293b' }}>💬 피드백 남기기</h3>
              <form onSubmit={handleAddComment} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '2px' }}>작성자</label>
                    <input type="text" value={authorName} onChange={(e) => setAuthorName(e.target.value)} style={{ width: '100%', padding: '6px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '12px' }} required />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '2px' }}>대상 음원</label>
                    <select value={selectedTrack} onChange={(e) => setSelectedTrack(e.target.value)} style={{ width: '100%', padding: '6px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '12px' }}>
                      {tracks.map((t) => (<option key={t.id} value={t.id}>{t.track_name}</option>))}
                    </select>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '2px' }}>시작점 (초)</label>
                    <input type="number" step="0.1" value={startTime} onChange={(e) => setStartTime(e.target.value)} style={{ width: '100%', padding: '6px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '12px' }} required />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '2px' }}>종료점 (초)</label>
                    <input type="number" step="0.1" value={endTime} onChange={(e) => setEndTime(e.target.value)} style={{ width: '100%', padding: '6px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '12px' }} required />
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '2px' }}>의견 내용</label>
                  <textarea value={newCommentText} onChange={(e) => setNewCommentText(e.target.value)} placeholder="의견을 적어주세요..." style={{ width: '100%', height: '60px', padding: '6px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '12px', resize: 'none' }} required />
                </div>

                <button type="submit" style={{ padding: '8px', background: '#0f172a', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}>
                  피드백 등록 🚀
                </button>
              </form>
            </div>

            <div style={{ padding: '16px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', height: '320px' }}>
              <h3 style={{ fontSize: '15px', fontWeight: 'bold', color: '#1e293b', marginBottom: '12px' }}>
                📋 피드백 목록 ({comments.length})
              </h3>
              <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '8px', paddingRight: '4px' }}>
                {comments.length === 0 ? (
                  <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: '13px', marginTop: '60px' }}>
                    등록된 피드백이 없습니다.
                  </div>
                ) : (
                  comments.map((c) => (
                    <div key={c.id} onClick={() => handleSeek(Number(c.start_time || 0))} style={{ padding: '10px', background: '#fff', borderRadius: '8px', cursor: 'pointer', border: '1px solid #e2e8f0' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px', flexWrap: 'wrap', gap: '4px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#4f46e5' }}>{c.author}</span>
                          <span style={{ fontSize: '10px', background: '#f1f5f9', color: '#475569', padding: '1px 6px', borderRadius: '4px', border: '1px solid #cbd5e1' }}>
                            🎵 {c.tracks?.track_name || '음원 정보 없음'}
                          </span>
                        </div>
                        <span style={{ fontSize: '10px', fontFamily: 'monospace', background: '#e0e7ff', color: '#3730a3', padding: '1px 4px', borderRadius: '4px' }}>
                          {formatTime(Number(c.start_time || 0))} ~ {formatTime(Number(c.end_time || c.start_time || 0))}
                        </span>
                      </div>
                      <p style={{ fontSize: '12px', color: '#334155', margin: 0 }}>{c.content}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div> 
  );
}