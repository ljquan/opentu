import {
  Album,
  ArrowLeft,
  Check,
  ChevronDown,
  FileMusic,
  Headphones,
  Heart,
  Library,
  ListMusic,
  Pause,
  Play,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Send,
  SlidersHorizontal,
  Sparkles,
  Volume2,
  Waves,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getDefaultAudioModel,
  useCanvasAudioPlayback,
  useSelectableModels,
} from '@drawnix/drawnix/runtime';
import { TaskStatus, TaskType } from '@drawnix/drawnix/task-types';
import type { Task } from '@drawnix/drawnix/task-types';
import { taskQueueService } from '@drawnix/drawnix/task-queue';
import {
  musicReleaseRepository,
  type MusicRelease,
  type MusicReleaseVisibility,
} from './music-station-repository';
import { useAccountSession } from '../account/use-account-session';
import './music-station-page.scss';

type StationView = 'station' | 'library' | 'lyrics';

const showcaseCovers = [
  '/product_showcase/aitu-04.png',
  '/product_showcase/aitu-05.png',
  '/product_showcase/aitu-06.png',
];

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${minutes.toString().padStart(2, '0')}:${rest}`;
}

function isMusicTask(task: Task): boolean {
  return (
    task.type === TaskType.AUDIO &&
    (task.params.sunoAction === 'music' || task.params.musicStation === true)
  );
}

function taskTitle(task: Task): string {
  return task.params.title || task.result?.title || '未命名乐章';
}

function releaseFromTask(task: Task): MusicRelease | null {
  if (!isMusicTask(task) || task.status !== TaskStatus.COMPLETED || !task.result?.url) {
    return null;
  }
  return {
    id: `task:${task.id}`,
    taskId: task.id,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    title: taskTitle(task),
    prompt: task.params.prompt,
    tags: String(task.params.tags || '')
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
    model: task.params.model || getDefaultAudioModel(),
    audioUrl: task.result.url,
    coverUrl: task.result.previewImageUrl,
    duration: task.result.duration,
    lyrics: task.result.lyricsText,
    providerTaskId: task.result.providerTaskId,
    clipId: task.result.primaryClipId,
    visibility: 'draft',
  };
}

function statusLabel(task: Task): string {
  if (task.status === TaskStatus.PENDING) return '等待中';
  if (task.status === TaskStatus.PROCESSING) return `${Math.round(task.progress || 0)}%`;
  if (task.status === TaskStatus.FAILED) return '失败';
  if (task.status === TaskStatus.CANCELLED) return '已取消';
  return '已完成';
}

type MusicStationPageProps = {
  onGoHome: () => void;
  onGoCreativeCenter: () => void;
  onOpenAccount: () => void;
};

export function MusicStationPage({
  onGoHome,
  onGoCreativeCenter,
  onOpenAccount,
}: MusicStationPageProps) {
  const { account, checking: checkingAccount } = useAccountSession();
  const audioModels = useSelectableModels('audio');
  const playback = useCanvasAudioPlayback();
  const [view, setView] = useState<StationView>('station');
  const [tasks, setTasks] = useState<Task[]>(() => taskQueueService.getAllTasks());
  const [releases, setReleases] = useState<MusicRelease[]>(() => musicReleaseRepository.list());
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('一首夜晚城市漫步的电子流行音乐，克制、温暖，有轻微的复古合成器质感');
  const [title, setTitle] = useState('夜航');
  const [tags, setTags] = useState('electronic pop, nocturnal, warm synth');
  const [model, setModel] = useState(getDefaultAudioModel());
  const [mv, setMv] = useState('chirp-v5-5');
  const [instrumental, setInstrumental] = useState(false);
  const [lyrics, setLyrics] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState('');
  const [playerSettingsOpen, setPlayerSettingsOpen] = useState(false);

  useEffect(() => {
    if (!audioModels.some((item) => item.id === model) && audioModels[0]) {
      setModel(audioModels[0].id);
    }
  }, [audioModels, model]);

  useEffect(() => {
    const subscription = taskQueueService.observeTaskUpdates().subscribe((event) => {
      setTasks((current) => {
        const next = current.filter((task) => task.id !== event.task.id);
        return [...next, event.task].sort((a, b) => b.updatedAt - a.updatedAt);
      });
    });
    return () => subscription.unsubscribe();
  }, []);

  const musicTasks = useMemo(
    () => tasks.filter(isMusicTask).sort((a, b) => b.updatedAt - a.updatedAt),
    [tasks]
  );
  const completedTracks = useMemo(() => {
    const storedByTask = new Map(releases.map((release) => [release.taskId, release]));
    return musicTasks
      .map((task) => {
        const stored = storedByTask.get(task.id);
        const fresh = releaseFromTask(task);
        return fresh && stored
          ? { ...fresh, id: stored.id, visibility: stored.visibility, updatedAt: stored.updatedAt }
          : fresh || stored || null;
      })
      .filter((release): release is MusicRelease => Boolean(release));
  }, [musicTasks, releases]);
  const activeTask = musicTasks.find((task) => task.id === selectedTaskId) || musicTasks[0];
  const activeTrack = (activeTask && releaseFromTask(activeTask)) ||
    (activeTask ? releases.find((release) => release.taskId === activeTask.id) : undefined) ||
    completedTracks[0];
  const activeLyrics = activeTrack?.lyrics || lyrics || '生成完成后，歌词会显示在这里。';
  const visibleTracks = useMemo(() => {
    const completedIds = new Set(completedTracks.map((track) => track.taskId));
    return [
      ...completedTracks,
      ...releases.filter((release) => !completedIds.has(release.taskId)),
    ];
  }, [completedTracks, releases]);
  const activeSource = activeTrack
    ? {
        audioUrl: activeTrack.audioUrl,
        title: activeTrack.title,
        duration: activeTrack.duration,
        previewImageUrl: activeTrack.coverUrl,
        providerTaskId: activeTrack.providerTaskId,
        clipId: activeTrack.clipId,
      }
    : null;

  const playTrack = useCallback(
    async (track: MusicRelease) => {
      const source = {
        audioUrl: track.audioUrl,
        title: track.title,
        duration: track.duration,
        previewImageUrl: track.coverUrl,
        providerTaskId: track.providerTaskId,
        clipId: track.clipId,
      };
      const queue = visibleTracks.map((item) => ({
        audioUrl: item.audioUrl,
        title: item.title,
        duration: item.duration,
        previewImageUrl: item.coverUrl,
        providerTaskId: item.providerTaskId,
        clipId: item.clipId,
      }));
      await playback.togglePlaybackInQueue(source, queue, {
        queueSource: 'playlist',
        queueName: '音乐台作品',
      });
      setSelectedTaskId(track.taskId);
    },
    [playback, visibleTracks]
  );

  const submitGeneration = async () => {
    if (!prompt.trim() || isSubmitting) return;
    if (String((import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_OPENTU_MANAGED_GENERATION || '').toLowerCase() === 'true') {
      setNotice('音乐生成暂未接入平台服务');
      return;
    }
    setIsSubmitting(true);
    setNotice('已加入生成队列');
    try {
      const selectedConfig = audioModels.find((item) => item.id === model);
      taskQueueService.createTask(
        {
          prompt: lyrics.trim() ? `${prompt.trim()}\n\n歌词：\n${lyrics.trim()}` : prompt.trim(),
          model,
          modelRef: selectedConfig?.sourceProfileId
            ? { profileId: selectedConfig.sourceProfileId, modelId: selectedConfig.id }
            : null,
          title: title.trim() || '未命名乐章',
          tags,
          mv,
          instrumental,
          sunoAction: 'music',
          musicStation: true,
          autoInsertToCanvas: false,
        },
        TaskType.AUDIO
      );
      setView('station');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '生成失败，请稍后重试');
    } finally {
      setIsSubmitting(false);
    }
  };

  const saveActiveRelease = () => {
    if (!activeTrack) return;
    setReleases(musicReleaseRepository.save(activeTrack));
    setNotice('已保存到我的作品');
  };

  const changeVisibility = (visibility: MusicReleaseVisibility) => {
    if (!activeTrack) return;
    setReleases(musicReleaseRepository.setVisibility(activeTrack.id, visibility));
    setNotice(visibility === 'public' ? '已在当前设备标记为公开' : visibility === 'private' ? '作品已设为私密' : '已恢复为草稿');
  };

  const cover = playback.activePreviewImageUrl || activeTrack?.coverUrl || showcaseCovers[0];
  const isActivePlaying = Boolean(playback.playing && activeTrack && playback.activeAudioUrl === activeTrack.audioUrl);

  return (
    <div className="music-station">
      <aside className="music-station__sidebar">
        <div className="music-station__brand">
          <img className="music-station__brand-mark" src="/icons/foxvue-mark.png" alt="" width="31" height="31" />
          <span>狐图 <small>FoxVue Music</small></span>
        </div>
        <button className="music-station__back" type="button" onClick={onGoHome}>
          <ArrowLeft size={16} /> 返回首页
        </button>
        <nav className="music-station__nav" aria-label="音乐台导航">
          <span className="music-station__nav-label">工作区</span>
          <button className={view === 'station' ? 'is-active' : ''} type="button" onClick={() => setView('station')}><Radio size={17} /> 音乐台</button>
          <button className={view === 'library' ? 'is-active' : ''} type="button" onClick={() => setView('library')}><Library size={17} /> 我的作品</button>
          <button className={view === 'lyrics' ? 'is-active' : ''} type="button" onClick={() => setView('lyrics')}><FileMusic size={17} /> 歌词本</button>
          <span className="music-station__nav-label music-station__nav-label--spaced">探索</span>
          <button
            type="button"
            onClick={() => {
              setView('library');
              setNotice('精选歌单暂未开放，先查看你的本地作品。');
            }}
          >
            <ListMusic size={17} /> 精选歌单
          </button>
          <button type="button" onClick={onGoCreativeCenter}><Waves size={17} /> 创作中心</button>
        </nav>
        <div className="music-station__sidebar-footer">
          <div className="music-station__service"><span /> {account ? '账户已连接' : '本地作品空间'}</div>
          <span className="music-station__account">{checkingAccount ? '正在读取账户' : account?.username || '未登录 · 本地创作空间'}</span>
        </div>
      </aside>

      <main className="music-station__main">
        <header className="music-station__topbar">
          <div><span className="music-station__kicker">FOX VUE / MUSIC</span><h1>{view === 'library' ? '我的作品' : view === 'lyrics' ? '歌词本' : '音乐台'}</h1></div>
          <div className="music-station__top-actions">
            <button className="music-station__quiet-button" type="button" onClick={onGoCreativeCenter}><Plus size={16} /> 新建创作</button>
            <button className="music-station__avatar" type="button" aria-label="账户设置" onClick={onOpenAccount}><img src="/icons/foxvue-mark.png" alt="" width="30" height="30" /></button>
          </div>
        </header>
        {notice && <p className="music-station__notice" role="status">{notice}</p>}

        {view === 'station' && (
          <>
            <section className="music-station__hero">
              <div>
                <span className="music-station__eyebrow"><Headphones size={14} /> 你的下一首歌</span>
                <h2>让灵感先<br /><em>听见自己。</em></h2>
                <p>写下一个画面、一种情绪，或者一句没有完成的歌词。平台模型会把它变成一首可以继续编辑的作品。</p>
              </div>
              <div className="music-station__hero-art"><img src={cover} alt="当前音乐封面" /><span>NOW<br />PLAYING</span></div>
            </section>

            <section className="music-station__workspace">
              <div className="music-station__composer">
                <div className="music-station__section-heading"><div><span className="music-station__section-index">01</span><div><h2>新建音乐</h2><p>从一个 brief 开始</p></div></div><Sparkles size={18} /></div>
                <label>音乐描述<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={4} placeholder="描述你想听见的画面、节奏和情绪" /></label>
                <label>歌词草稿<span className="music-station__optional">可选</span><textarea className="music-station__lyrics-input" value={lyrics} onChange={(event) => setLyrics(event.target.value)} rows={3} placeholder="写下副歌、几句意象，或留给模型自由发挥" /></label>
                <div className="music-station__field-row"><label>标题<input value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>风格标签<input value={tags} onChange={(event) => setTags(event.target.value)} /></label></div>
                <div className="music-station__controls"><label>模型<select value={model} onChange={(event) => setModel(event.target.value)}>{(audioModels.length ? audioModels : [{ id: getDefaultAudioModel(), label: 'Suno Music' }]).map((item) => <option value={item.id} key={item.id}>{(('shortLabel' in item && item.shortLabel) || item.label)}</option>)}</select></label><label>版本<select value={mv} onChange={(event) => setMv(event.target.value)}><option value="chirp-v5-5">Suno v5.5</option><option value="chirp-v5">Suno v5</option><option value="chirp-v4-5">Suno v4.5</option></select></label><button className={`music-station__toggle ${instrumental ? 'is-on' : ''}`} type="button" onClick={() => setInstrumental((value) => !value)}><span>{instrumental ? <Check size={13} /> : null}</span> 纯音乐</button></div>
                <button className="music-station__generate" type="button" onClick={() => void submitGeneration()} disabled={!prompt.trim() || isSubmitting}><span>{isSubmitting ? <RefreshCw className="is-spinning" size={17} /> : <Sparkles size={17} />}</span>{isSubmitting ? '正在加入队列' : '生成音乐'}<span className="music-station__generate-meta">使用当前模型配置</span></button>
              </div>

              <div className="music-station__player-column">
                <div className="music-station__player-card">
                  <div className="music-station__player-head"><span>当前播放</span><button type="button" aria-label="播放器设置" aria-expanded={playerSettingsOpen} onClick={() => setPlayerSettingsOpen((open) => !open)}><SlidersHorizontal size={16} /></button></div>
                  {playerSettingsOpen && <div className="music-station__player-settings"><label><span>音量</span><input type="range" min="0" max="1" step="0.05" value={playback.volume} onChange={(event) => playback.setVolume(Number(event.target.value))} aria-label="播放器音量" /><b>{Math.round(playback.volume * 100)}%</b></label></div>}
                  <div className="music-station__player-art"><img src={cover} alt="音乐封面" /><div className="music-station__art-overlay"><span /><span /><span /><span /><span /></div></div>
                  <div className="music-station__track-info"><div><h2>{playback.activeTitle || activeTrack?.title || '等待一首新歌'}</h2><p>{activeTrack?.tags.join(' · ') || '你的音乐作品会出现在这里'}</p></div><Heart size={18} /></div>
                  <div className="music-station__waveform">{Array.from({ length: 40 }).map((_, index) => <span key={index} style={{ height: `${10 + ((index * 19) % 30)}%` }} />)}</div>
                  <input className="music-station__progress" type="range" min="0" max={Math.max(playback.duration, activeTrack?.duration || 1)} value={Math.min(playback.currentTime, Math.max(playback.duration, activeTrack?.duration || 1))} onChange={(event) => playback.seekTo(Number(event.target.value))} aria-label="播放进度" disabled={!activeSource} />
                  <div className="music-station__time"><span>{formatTime(playback.currentTime)}</span><span>{formatTime(playback.duration || activeTrack?.duration || 0)}</span></div>
                  <div className="music-station__transport"><button type="button" aria-label="降低音量" onClick={() => playback.setVolume(Math.max(0, playback.volume - 0.1))}><Volume2 size={16} /></button><button type="button" aria-label="上一首" onClick={playback.playPrevious} disabled={!activeSource}><RotateCcw size={15} /></button><button className="music-station__play" type="button" aria-label={isActivePlaying ? '暂停' : '播放'} onClick={() => activeSource && void playback.togglePlayback(activeSource)} disabled={!activeSource}>{isActivePlaying ? <Pause size={21} /> : <Play size={21} fill="currentColor" />}</button><button type="button" aria-label="下一首" onClick={playback.playNext} disabled={!activeSource}><ChevronDown size={17} className="music-station__next-icon" /></button><button type="button" aria-label="提高音量" onClick={() => playback.setVolume(Math.min(1, playback.volume + 0.1))}><Volume2 size={16} /></button></div>
                  {activeTrack && <div className="music-station__player-actions"><button type="button" onClick={saveActiveRelease}><Library size={15} /> 保存草稿</button><button type="button" onClick={() => changeVisibility('public')}><Send size={15} /> 标记公开</button></div>}
                </div>
                <div className="music-station__lyrics-card"><div className="music-station__card-heading"><span>歌词</span><button type="button" onClick={() => setView('lyrics')}>查看全文 <ArrowLeft size={13} className="is-rotated" /></button></div><p>{activeLyrics.split('\n').slice(0, 5).join('\n')}</p></div>
              </div>
            </section>
          </>
        )}

        {view === 'library' && <section className="music-station__library-view"><div className="music-station__library-intro"><div><span className="music-station__eyebrow"><Library size={14} /> 本地作品库</span><h2>每一个版本<br /><em>都值得保留。</em></h2></div><p>草稿保存在当前设备。公开标记会跟随本机作品记录，后续可连接账号与云端同步。</p></div><div className="music-station__release-grid">{visibleTracks.length ? visibleTracks.map((track) => <button className="music-station__release-card" type="button" key={track.id} onClick={() => void playTrack(track)}><img src={track.coverUrl || showcaseCovers[track.taskId.length % showcaseCovers.length]} alt="" /><span><strong>{track.title}</strong><small>{track.tags.join(' · ') || '未添加风格'}</small><small className="music-station__release-status">{track.visibility === 'public' ? '本机公开' : track.visibility === 'private' ? '私密' : '草稿'}</small></span><span className="music-station__release-play"><Play size={16} fill="currentColor" /></span></button>) : <div className="music-station__empty"><Album size={28} /><h3>还没有作品</h3><p>写下一个 brief，开始你的第一首歌。</p><button type="button" onClick={() => setView('station')}>开始创作</button></div>}</div></section>}

        {view === 'lyrics' && <section className="music-station__lyrics-view"><div className="music-station__lyrics-view-head"><div><span className="music-station__eyebrow"><FileMusic size={14} /> 歌词本</span><h2>{activeTrack?.title || '未命名乐章'}</h2><p>{activeTrack?.tags.join(' · ') || '等待生成歌词'}</p></div><button type="button" onClick={() => setView('station')}><ArrowLeft size={15} /> 返回音乐台</button></div><article className="music-station__lyrics-sheet"><div className="music-station__lyrics-sheet-meta"><span>LYRICS / 01</span><span>{activeTrack ? new Date(activeTrack.updatedAt).toLocaleDateString('zh-CN') : 'DRAFT'}</span></div><div className="music-station__lyrics-text">{activeLyrics.split('\n').map((line, index) => <p key={`${line}-${index}`} className={line.trim().startsWith('[') ? 'is-section' : ''}>{line || ' '}</p>)}</div></article></section>}

        {activeTask && (activeTask.status === TaskStatus.PROCESSING || activeTask.status === TaskStatus.PENDING || activeTask.status === TaskStatus.FAILED) && <section className="music-station__task-strip"><div><span className="music-station__task-dot" /><strong>{taskTitle(activeTask)}</strong><small>{activeTask.status === TaskStatus.FAILED ? activeTask.error?.message || '生成失败' : '音乐正在生成中，完成后会自动出现在播放器'}</small></div><span className="music-station__task-progress">{statusLabel(activeTask)}</span>{activeTask.status === TaskStatus.FAILED && <button type="button" onClick={() => taskQueueService.retryTask(activeTask.id)}><RefreshCw size={14} /> 重试</button>}{(activeTask.status === TaskStatus.PROCESSING || activeTask.status === TaskStatus.PENDING) && <button type="button" onClick={() => taskQueueService.cancelTask(activeTask.id)}>取消</button>}</section>}
      </main>
    </div>
  );
}

export default MusicStationPage;
