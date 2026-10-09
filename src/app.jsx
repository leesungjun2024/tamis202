import React, { useState, useRef, useEffect } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { supabase } from './supabaseClient';

export default function App() {
  // 1. 인증(Login) 상태
  const [user, setUser] = useState(null);   
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);

  // 2. 탭 및 포트폴리오 관리 상태 ('studio' | 'portfolio')
  const [activeTab, setActiveTab] = useState('portfolio');
  const [myPortfolios, setMyPortfolios] = useState([]);
  const [currentPortfolioId, setCurrentPortfolioId] = useState(null);
  const [portfolioName, setPortfolioName] = useState('새 포트폴리오');
  const [portfolioMembers, setPortfolioMembers] = useState([]);
  const [inviteEmail, setInviteEmail] = useState('');

  // 3. 오디오 재생 및 타임라인 상태
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // 4. 트랙 리스트
  const [tracks, setTracks] = useState([]);

  // 5. 피드백 및 댓글 상태
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

  // 세션 체크 및 초기화
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchMyPortfolios(session.user.id);
        setAuthorName(session.user.email.split('@')[0]);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchMyPortfolios(session.user.id);
        setAuthorName(session.user.email.split('@')[0]);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const handleAuth = async (e) => {
    e.preventDefault();
    if (isSignUp) {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) alert(error.message);
      else alert('회원가입 성공! 로그인해주세요.');
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) alert(error.message);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setCurrentPortfolioId(null);
    setTracks([]);
    setComments([]);
    setPortfolioMembers([]);
  };

  // 나의 포트폴리오 목록 불러오기
  const fetchMyPortfolios = async (userId) => {
    const { data, error } = await supabase
      .from('portfolios')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data) {
      setMyPortfolios(data);
    }
  };

  // 특정 포트폴리오 열기
  const handleLoadPortfolio = async (portfolio) => {
    setCurrentPortfolioId(portfolio.id);
    setPortfolioName(portfolio.portfolio_name);
    setActiveTab('studio');

    // 1. 해당 포트폴리오의 음원(Tracks) 불러오기
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

    // 2. 해당 포트폴리오의 피드백 불러오기
    const { data: feedbackData } = await supabase
      .from('feedbacks')
      .select(`
        *,
        tracks (
          track_name
        )
      `)
      .eq('portfolio_id', portfolio.id);

    if (feedbackData) {
      const sorted = feedbackData.sort((a, b) => (a.start_time || 0) - (b.start_time || 0));
      setComments(sorted);
    } else {
      setComments([]);
    }

    // 3. 포트폴리오 멤버 불러오기
    const { data: memberData } = await supabase
      .from('portfolio_members')
      .select('*')
      .eq('portfolio_id', portfolio.id);

    setPortfolioMembers(memberData || []);
  };

  // 새 포트폴리오 생성
  const handleCreatePortfolio = async () => {
    if (!user) return;
    const title = prompt('새 포트폴리오 이름을 입력하세요:', '나의 새 포트폴리오');
    if (!title) return;

    const { data, error } = await supabase
      .from('portfolios')
      .insert([{ portfolio_name: title, user_id: user.id }])
      .select()
      .single();

    if (error) {
      alert('포트폴리오 생성 실패');
    } else {
      fetchMyPortfolios(user.id);
      handleLoadPortfolio(data);
    }
  };

  // 사용자 초대 및 권한 부여
  const handleInviteMember = async (e) => {
    e.preventDefault();
    if (!inviteEmail.trim() || !currentPortfolioId) return;

    const { error } = await supabase
      .from('portfolio_members')
      .insert([{ portfolio_id: currentPortfolioId, member_email: inviteEmail, role: 'editor' }]);

    if (error) {
      alert('사용자 초대 실패 (이미 초대되었거나 잘못된 이메일일 수 있습니다)');
    } else {
      alert(`${inviteEmail} 님을 편집자로 초대했습니다!`);
      setInviteEmail('');
      const { data } = await supabase
        .from('portfolio_members')
        .select('*')
        .eq('portfolio_id', currentPortfolioId);
      setPortfolioMembers(data || []);
    }
  };

  // WaveSurfer 파형 초기화 (CORS 우회를 위해 crossorigin 설정 추가)
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
        xhr: {
          cache: 'default',
          mode: 'cors',
        }
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

  // CORS 프리오픈된 공공 오디오 샘플 URL 연동
  const handleMultipleUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0 || !currentPortfolioId) {
      alert('포트폴리오를 먼저 열어주세요!');
      return;
    }

    // CORS 정책이 완전히 허용된 안정적인 외부 오디오 소스 샘플
    const corsSafeUrls = [
      'https://upload.wikimedia.org/wikipedia/commons/b/b2/Beethoven_Moonlight_1st_movement.ogg',
      'https://upload.wikimedia.org/wikipedia/commons/6/69/Chopin_Prelude_Op_28_No_4_Cortot.ogg',
      'https://upload.wikimedia.org/wikipedia/commons/c/c8/J.S._Bach_-_Goldberg_Variations_-_01_-_Aria.ogg'
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

  // 피드백 등록
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
    };

    const { data, error } = await supabase.from('feedbacks').insert([newComment]).select();

    if (error) {
      alert('피드백 저장 중 오류가 발생했습니다.');
    } else {
      if (data && data.length > 0) {
        const targetTrack = tracks.find((t) => t.id === selectedTrack);
        const commentWithTrack = {
          ...data[0],
          tracks: { track_name: targetTrack ? targetTrack.track_name : '알 수 없는 음원' }
        };

        setComments((prev) => [...prev, commentWithTrack].sort((a, b) => a.start_time - b.start_time));
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

  return (
    <div style={{ maxWidth: '900px', margin: '30px auto', padding: '24px', background: '#fff', borderRadius: '16px', boxShadow: '0 4px 20px rgba(0,0,0,0.08)', fontFamily: 'sans-serif' }}>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', padding: '12px 16px', background: '#f8fafc', borderRadius: '10px', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#4f46e5' }}>👤 {user.email}</span> 님 접속중
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => setActiveTab('portfolio')} style={{ padding: '6px 12px', background: activeTab === 'portfolio' ? '#4f46e5' : '#e2e8f0', color: activeTab === 'portfolio' ? '#fff' : '#334155', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}>
            📁 포트폴리오 목록 ({myPortfolios.length})
          </button>
          <button onClick={() => {
            if (!currentPortfolioId) {
              alert('열려있는 포트폴리오가 없습니다. 목록에서 포트폴리오를 먼저 열어주세요!');
              return;
            }
            setActiveTab('studio');
          }} style={{ padding: '6px 12px', background: activeTab === 'studio' ? '#4f46e5' : '#e2e8f0', color: activeTab === 'studio' ? '#fff' : '#334155', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}>
            🎛️ 스튜디오 (현재: {currentPortfolioId ? portfolioName : '선택 안됨'})
          </button>
          <button onClick={handleLogout} style={{ padding: '6px 12px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}>
            로그아웃
          </button>
        </div>
      </div>

      {activeTab === 'portfolio' ? (
        <div style={{ padding: '20px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h2 style={{ fontSize: '20px', fontWeight: 'bold', color: '#1e293b', margin: 0 }}>📁 포트폴리오 관리 및 선택</h2>
            <button onClick={handleCreatePortfolio} style={{ padding: '8px 14px', background: '#10b981', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px' }}>
              ➕ 새 포트폴리오 만들기
            </button>
          </div>

          {myPortfolios.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#64748b', padding: '40px', background: '#f8fafc', borderRadius: '10px' }}>
              생성된 포트폴리오가 없습니다. 새 포트폴리오를 만들어 음악과 피드백을 관리해 보세요!
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {myPortfolios.map((p) => (
                <div key={p.id} style={{ padding: '16px', background: '#f1f5f9', borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #e2e8f0' }}>
                  <div>
                    <span style={{ fontWeight: 'bold', color: '#1e293b', fontSize: '16px', display: 'block', marginBottom: '4px' }}>{p.portfolio_name}</span>
                    <span style={{ fontSize: '12px', color: '#64748b' }}>생성일: {new Date(p.created_at).toLocaleDateString()}</span>
                  </div>
                  <button onClick={() => handleLoadPortfolio(p)} style={{ padding: '8px 14px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}>
                    📂 포트폴리오 열기 (스튜디오 진입)
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          <div style={{ marginBottom: '20px', padding: '16px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '10px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 'bold', color: '#1e293b', margin: 0 }}>
                🎵 현재 포트폴리오: <span style={{ color: '#4f46e5' }}>{portfolioName}</span>
              </h2>
              <label style={{ padding: '6px 12px', background: '#3b82f6', color: '#fff', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px', display: 'inline-block' }}>
                📁 음원 추가하기 (CORS 안전 샘플)
                <input type="file" multiple accept="audio/*" onChange={handleMultipleUpload} style={{ display: 'none' }} />
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #e2e8f0', paddingTop: '12px', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#334155', marginRight: '8px' }}>👥 사용자 접속 현황 및 권한:</span>
                <span style={{ fontSize: '12px', background: '#dbeafe', color: '#1e40af', padding: '2px 8px', borderRadius: '6px', marginRight: '6px' }}>
                  {user.email} (소유자)
                </span>
                {portfolioMembers.map((m) => (
                  <span key={m.id} style={{ fontSize: '12px', background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: '6px', marginRight: '6px' }}>
                    {m.member_email} ({m.role})
                  </span>
                ))}
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
                등록된 음원이 없습니다. 상단의 '음원 추가하기'를 통해 음악을 업로드하세요.
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
              <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '12px', color: '#1e293b' }}>💬 포트폴리오 전용 피드백 남기기</h3>
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
                  <textarea value={newCommentText} onChange={(e) => setNewCommentText(e.target.value)} placeholder="파형을 클릭하거나 의견을 적어주세요..." style={{ width: '100%', height: '60px', padding: '6px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '12px', resize: 'none' }} required />
                </div>

                <button type="submit" style={{ padding: '8px', background: '#0f172a', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}>
                  피드백 등록 🚀
                </button>
              </form>
            </div>

            <div style={{ padding: '16px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', height: '320px' }}>
              <h3 style={{ fontSize: '15px', fontWeight: 'bold', color: '#1e293b', marginBottom: '12px' }}>
                📋 이 포트폴리오의 피드백 목록 ({comments.length})
              </h3>
              <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '8px', paddingRight: '4px' }}>
                {comments.length === 0 ? (
                  <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: '13px', marginTop: '60px' }}>
                    이 포트폴리오에 등록된 피드백이 없습니다.
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
        </>
      )}
    </div> 
  );
}