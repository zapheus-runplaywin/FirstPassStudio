// FirstPass Studio - what the Studio pages read from Studio: the scene (/api/scene and the scene socket, scene.ts
// state() with sequences.ts, music.ts and mics.ts state() in it), the outputs (/api/outputs, outputs.ts state()), and
// the answers more than one page reads (the board's game and team sheets, a Socials night).
// Only the parts the pages use. Studio's own answers, so typed as they are rather than checked. Types only: it
// declares nothing a page can call, so both public/tsconfig.json and public/output/tsconfig.json read it.

// ─── The scene ────────────────────────────────────────────────────────
type SourceType = 'browser' | 'image' | 'video';
interface Source {
  id: string; type: SourceType; name: string; visible: boolean; fadeMs: number; x: number; y: number; scale: number;
  out?: Record<string, true>; url?: string; width: number; height: number; reloadOnShow?: boolean;
  file?: string; loop?: boolean; restartOnShow?: boolean; hideWhenDone?: boolean; sound?: boolean; volume?: number;
  // Each showing (scene.ts): loadSeq goes up on Restart, showSeq each time it comes on (outSeq on another output);
  // playAt, when a video started on each output; soundOut, its sound fading out under the next music on an output.
  loadSeq?: number; showSeq?: number; outSeq?: Record<string, number>; playAt?: Record<string, number>;
  soundOut?: Record<string, { at: number; ms: number; showSeq: number }>;
}
// A switcher action on a scene or a step (switcher.ts SwitcherAction).
interface SwAction { type: string; input?: number; name?: string; key?: number; on?: string; mix?: boolean; macro?: number; atSec: number }
interface Scene { id: string; name: string; colour: string; states: Record<string, string>; quiet: boolean; switcher?: SwAction[] }

// Sequences (sequences.ts): a step as saved, and as the editor builds it.
type StepLengthType = 'time' | 'done' | 'next' | 'game' | 'now';
interface StepLength { type: string; sec?: number }
// A step (sequences.ts Step): sources for a time, a scene, another sequence, or sponsor ads.
interface SourcesStep { id?: string; kind?: undefined; sources: string[]; length: StepLength; switcher?: SwAction[] }
interface SceneStep { id?: string; kind: 'scene'; scene: string; sources: string[]; length: StepLength; switcher?: SwAction[] }
interface SequenceStep { id?: string; kind: 'sequence'; sequence: string; sources?: undefined; switcher?: undefined }
interface AdsStep { id?: string; kind: 'ads'; count: number; house: boolean; sources?: undefined; switcher?: undefined }
type Step = SourcesStep | SceneStep | SequenceStep | AdsStep;
type SeqStart = { type: 'hand' } | { type: 'before'; min: number } | { type: 'fulltime'; afterSec: number } | { type: 'break'; breaks: string[]; afterSec: number };
interface SeqThen { type: string; scene?: string; sequence?: string }
interface SeqMusic { playlist?: string; track?: string; startStep?: number; startAtSec?: number; fadeInSec?: number; underVideo?: true }
interface Sequence {
  id: string; name: string; colour: string; repeat: string; start: SeqStart; then: SeqThen; music: SeqMusic | null;
  musicEnd: { type: string; sec?: number }; quiet: boolean; hidden: boolean; playsOn: string[]; thenOn: Record<string, SeqThen>; steps: Step[];
  until?: { moment: string; min?: number }; goneOn?: string[]; startGone?: boolean;
}
// What's playing on an output, and a triggered start counting down (sequences.ts playingHere(), pendingHere()).
interface Playing {
  id: string; step: number; steps: number; loop: number; paused: boolean; top: number | null; via: string[]; scene: string | null; sources: string[];
  ad?: string | null; leftMs: number | null; length: string | null; ready: boolean; totalLeftMs?: number; totalOpen?: boolean; repeats: boolean;
  waiting: string[]; finishing: boolean;
}
interface Pending { id: string; reason: string; leftMs: number | null }
// The run order (Output 1's): its items and what it has played tonight.
interface RunItem { key: string; kind: 'sequence' | 'scene'; id: string; name: string; gone?: boolean; at?: number }
interface GameInfo { label: string; startAt: number | null; breaks: Record<string, number> | null; last: number }

// The music player (music.ts state()).
interface Ease { from: number; to: number; at: number; ms: number }
// The song fading out under new music (a crossfade).
interface MusicTail { track: string; pos: { sec: number; at: number }; gain: Ease; playId: number; volume: number }
interface MusicState {
  track: string | null; queue: string[]; index: number; playlist: string | null; loop: boolean; status: 'stopped' | 'playing' | 'paused';
  after: string | null; pos: { sec: number; at: number }; gain: Ease; playId: number; muted: boolean; ducked: boolean; duckedBy: string | null;
  duck: Ease; video: string | null; owner: string | null; tail: MusicTail | null; volume: number; duckTo: number; length: number | null;
}
interface Playlist { id: string; name: string; tracks: string[]; shuffle: boolean; loop: boolean }
interface MusicSettings {
  fadeInSec: number; fadeOutSec: number; quickSec: number; volume: number; underVideo: string; duckTo: number; superShotSong: string; superShotVolume: number;
}

// The mics (mics.ts state()).
interface Mic { id: string; name: string; on: string; device: string; input: number; phone: string; channel: string; level: number; muted: boolean; lowCut: boolean; follow: boolean }
interface MicsState {
  v: number; level: number; muted: boolean; dipTo: number; dipMusic: boolean; dipVideo: boolean; dipQuiet: boolean; dipDownSec: number; dipUpSec: number;
  mics: Mic[]; dipped: boolean; why: string[]; hand: boolean | null; dip: Ease;
}

// What the output windows hear from the mics (/api/scene/mics/live, mics.ts live()).
interface MicLive {
  mixing: boolean; devices: string[]; levels: Record<string, number>; silent?: Record<string, number>; problems: Record<string, string>; status: string;
  switcher: { connected: boolean; inputs: { id: number; name: string; split?: boolean }[] }; faders: Record<string, number>;
}
// A mic as the editor builds it: a new one has no id yet.
type MicDraft = Partial<Mic> & { name: string; on: string; channel: string; lowCut: boolean; follow: boolean };

// The whole scene as Studio sends it, and as the page views it for the output picked over the Scene View (viewFor()).
interface SceneState {
  rev?: number; width?: number; height?: number; sources: Source[]; scenes?: Scene[];
  current?: string | null; currentOut?: Record<string, string>; changed?: string[]; changedOut?: Record<string, string[]>;
  converting?: string[]; html?: string;
  sequences?: Sequence[]; playing?: Playing | null; playingOut?: Record<string, Playing>; auto?: boolean;
  pending?: Pending | null; pendingOut?: Record<string, Pending>; stoppedOn?: Record<string, string>;
  runOrder?: RunItem[] | null; runOrderPlayed?: RunItem[] | null; runOrders?: { id: string; name: string; count: number }[]; runOrderNotice?: { text: string; at: number } | null;
  nextAuto?: { id: string; at: number } | null; game?: GameInfo | null;
  music?: MusicState; playlists?: Playlist[]; musicSettings?: MusicSettings; mics?: MicsState;
  error?: string;
}
interface SceneView extends SceneState {
  onOut?: { scenes: Record<string, OutputInfo[]>; sequences: Record<string, OutputInfo[]> };
  viewOutput?: string; viewName?: string; viewDeck?: string; viewColour?: string; viewMany?: boolean;
}

// ─── The outputs (outputs.ts state()) ────────────────────────────────
// A window the Mac app has open for an output (outputs.ts Shown).
interface OutputWindow { output: string; kind: string; display?: string; safe?: boolean }
// Where an output's sound goes, and how it's doing there (outputs.ts Dest, soundState()).
interface SoundDest { device: string; mics: string[] }
interface SoundDestState extends SoundDest { state: 'off' | 'waiting' | 'sending' | 'problem'; error: string }
interface Perf { cpu: number; memMB: number; fps: number; target: number }
// How a Blackmagic output or an output's NDI sources are doing, as the app says.
interface DecklinkStatus { running?: boolean; error?: string; name?: string; mode?: string; sound?: string; late?: number; dropped?: number }
interface NdiStatus { running?: boolean; error?: string; format?: string; sources?: { name: string; connections?: number }[] }
interface OutputInfo {
  id: string; slot: number; name: string; mode: string; on: boolean;
  chromaDisplay: string; chromaColor: string; chromaSafe: boolean; fillDisplay: string; keyDisplay: string;
  decklinkDevice: string; decklinkMode: number; decklinkKeying: string; decklinkStraight: boolean;
  ndiSignal: string; ndiOwnName: boolean; ndiName: string; ndiFormat: string; sponsors: boolean;
  keyer: string; swFill: number; swKey: number; swCameras: number[]; sound: SoundDest[];
  colour: string; primary: boolean; link: string; ndiSource: string; chromaSafeNow: boolean; showing: OutputWindow[];
  keyerNow: string; signal: string; clash: string; decklinkStatus: DecklinkStatus; ndiStatus: NdiStatus; perf: Perf | null;
  soundState: SoundDestState[]; picture: { uhd: boolean; format: string; why: string }; nearKey: { name: string; hex: string }[];
}
interface Display { id: string; label: string; width: number; height: number; scale: number; primary: boolean }
interface DeckMode { mode: number; name: string; height: number; interlaced: boolean; supported?: boolean; keying?: boolean }
interface OutputsState {
  outputs: OutputInfo[]; quality: string; soft: { what: string; name: string; width: number; height: number }[]; max: number; app: boolean; displays: Display[];
  decklink: { ok: boolean; error: string; devices?: { id: string; name: string; modes: DeckMode[]; externalKeying?: boolean }[] };
  ndi: { ok: boolean; error: string }; ndiFormats: { id: string }[]; perfTotal: { cpu: number; memMB: number; gpu: number } | null;
  error?: string;
}

// What each output's sound destination is sending now (/api/outputs/sound, outputs.ts soundLive()): "output id|where" -> its level.
interface SoundLevel { peak: number[]; rate?: number; channels?: number; dry?: number }

// A file in the media folder (/api/media).
interface MediaFile { name: string; kind: string | null; converted?: string; opaque?: string; size?: number; duration?: number | null; converting?: boolean; levelled?: boolean; uses?: { type: string; name: string; onAir?: boolean }[] }
// What Studio answers a change to the scene with (act()): the scene, or an error.
type SceneAnswer = SceneState & { ok?: boolean; [more: string]: unknown };

// /api/health (server.ts health()), the parts the status board reads beyond the tab bar's (studiobar.ts).
interface Health extends StudioHealth {
  competition: string;
  output: NonNullable<StudioHealth['output']> & { onAir: { name: string; colour?: string }[] };
  game: { label: string; court?: string; phase?: string; ended?: boolean } | null;
  playhq: NonNullable<StudioHealth['playhq']> & {
    readAgoMs: number | null; error?: string; refreshSec?: number; pace?: string;
    net: { pingMs: number | null; pingAgoMs: number | null; failed: boolean; bytesPerSec: number; bytes: number; requests: number };
  };
  playing: { name?: string; step: number; steps: number; paused?: boolean; leftMs?: number | null; totalLeftMs?: number | null; totalOpen?: boolean } | null;
  score: { home: number; away: number; homeName: string; awayName: string } | null;
  autoNote: string;
  autoNext: { home: string; away: string; startAt?: number | null; switchAt?: number | null } | null;
  recording: { on: boolean; name: string; record: boolean };
}

// A section says it folded or opened (common.ts setFolded()).
interface HTMLElementEventMap { fold: CustomEvent<{ open: boolean }> }
// What the Scene View's frame (scene.html) says to a page standing it by.
interface Window { standbyReady?: () => boolean }

// The switcher (switcher.ts status()): set up or not, how it's answering, and while connected its inputs and keys.
interface SwInput { id: number; name: string; short?: string }
interface SwKeyCheck {
  output: string; name: string; colour: string; keyer: string; label: string; onAir: boolean; problems: string[]; fixes: string[];
  cameras: number[]; withCamera: string; want?: { straightOff?: boolean };
}
interface SwitcherState {
  rev: number; setUp: boolean; state: string; since: number; error: string; canFind: boolean; finding: boolean;
  pick: { kind: 'found' | 'address'; name?: string; address: string; port: number } | null;
  found: { name: string; model: string; host: string; port: number; address: string }[];
  stingerOutput: { id: string; name: string; on: boolean }; lineup: number; follow: boolean;
  stinger: string; stingerId: string; stingerMusic: string; keys: SwKeyCheck[]; fps?: number;
  model: string; inputs: SwInput[]; program: number | null; preview: number | null; inTransition: boolean; usk: boolean[]; dsk: boolean[]; ftb: boolean;
}

// What /api/firstpass/onair answers (firstpassfigures.ts OnAir): the FirstPass team's side, its named shooters and totals.
interface FirstPassOnAir {
  side: 'home' | 'away'; team: string; period: number; score: { us: number; them: number };
  shooting: { players: { name: string; positions: string[]; goals: number; shots: number }[]; team: { goals: number; shots: number } };
  centrePass: { us: { received: number; goals: number }; them: { received: number; goals: number } };
  gains: number; turnovers: number; named: number; teamTotalsOnly: number;
}
// What /api/teams answers (teams.ts getTeamSheets): the board's game with each side's line up, for loadTeams().
interface SheetPlayer {
  name: string; number: string | number | null; position: string; captain?: boolean; viceCaptain?: boolean; fromSquad?: boolean; photo?: string | null; silhouette?: string;
  shooting?: { goals: number; superGoals: number; shots: number | null; points: number } | null;
}
interface SheetSide { name: string; logo?: string | null; players: SheetPlayer[]; totals?: { goals: number; superGoals: number; shots: number | null } | null; squad?: boolean }
interface TeamSheets {
  home: SheetSide; away: SheetSide; division?: string; court?: string; period?: number; competition?: string; error?: string; scoring?: string;
  score?: { home: number; away: number }; rules?: { superShots?: boolean; [more: string]: unknown };
}

// The competition logos in a setup's rules (/api/scoreboard and others), for a light or a dark picture behind them.
interface LogoRules { competitionLogo?: string; competitionLogoLight?: string; competitionLogoDark?: string }

// What /api/scoreboard answers (board.ts scoreboardJson): the board's game with the setup's rules, the teams' logos and
// colours, and the board's clock. These are the fields the graphics read; a page that reads more extends it.
interface ScoreboardView {
  competition?: string; division?: string; round?: string; date?: string; time?: string; court?: string; venue?: string; venueName?: string;
  home: { name: string; score: number }; away: { name: string; score: number }; period: number; periodLabel?: string;
  logos?: { home?: string | null; away?: string | null }; teamColours?: { home?: string | null; away?: string | null };
  rules?: LogoRules & { superShots?: boolean; periodType?: string; periods?: number; [more: string]: unknown };
  superShot?: { n: number; side: 'home' | 'away'; at: number; how?: string }; serverNow?: number; source?: string;
  clock?: { running: boolean; lengthSec: number }; clockElapsedMs?: number;
}

// ─── Socials (socials.ts) ────────────────────────────────────────────
// What /api/socials/night answers every time (night()), read by the Socials tab and by social.html; social.html
// types the parts &with= asks for. A side of a game and a game as the pictures draw them (socials.ts Brief).
interface SocialTeam { name: string; logo: string | null; score: number | null; colour?: string | null }
interface SocialGame {
  id: string; date: string; time: string; court: string; venue: string; division: string; round: string; home: SocialTeam; away: SocialTeam;
  finished: boolean; winner: 'home' | 'away' | 'draw' | null; final?: string;
}
// The night's streamed court from the Production Planner (planner.ts onStream): each game called and who calls it.
interface SocialPerson { name: string; guest: boolean; headshot: string | null }
interface StreamSlot { id: string; time: string; division: string; home: { name: string; logo: string | null }; away: { name: string; logo: string | null }; people: SocialPerson[] }
// A colour set and a picture set (socials.ts ColourSet, PictureSet), and the tab's settings (socials.json).
interface ColourSet { id: string; name: string; ground: string; highlight: string; accent: string; contrast?: number; own?: boolean }
interface PictureSet { id?: string; name: string; kinds: string[] }
interface SocialsSettings {
  mark: boolean; pivt: boolean; sponsor: Record<string, boolean>; colours: string; colourSets: ColourSet[]; template: string;
  favourites: string[]; favouritesOnly: boolean; movers: boolean; pictureSets: (PictureSet & { id: string })[]; pictureSet: string;
  hashtags: string;
}
// A kept story's worm (board.ts getWorm): the margin over game time in segments, and each team's biggest lead.
interface SocialWorm {
  segments?: { t: number; margin: number }[][]; periods?: number; end?: number; regularPeriods?: number; periodLabel?: string;
  biggestLead?: { home?: { margin: number } | null; away?: { margin: number } | null }; leadChanges?: number;
}
type HomeAway<T> = { home: T; away: T };
// Of the night, from the stories of the games Studio streamed or followed (socials.ts ofTheNight).
interface OfTheNight {
  runs: { game: SocialGame; longest: { side: 'home' | 'away'; n: number }; runs3: HomeAway<number>; runs5: HomeAway<number>; complete: boolean }[];
  supers: { game: SocialGame; points: HomeAway<number>; byPeriod: ({ n: number } & HomeAway<number>)[]; periodLabel: string }[];
  comeback: { game: SocialGame; side: 'home' | 'away'; down: number; worm: SocialWorm; complete: boolean } | null;
}
// A finished game's line ups (games.ts readLineups), for the hand picks.
interface SocialLineup {
  id: string; division: string; read: boolean;
  home: { name: string; players: { name: string; position?: string }[] }; away: { name: string; players: { name: string; position?: string }[] };
}
interface SocialsNight {
  error?: string; date: string; today: boolean; competition: string; competitionLogo: string | null; running: string; winners: string; venue: string;
  games: SocialGame[]; stream: { court: string; slots: StreamSlot[] } | null; sponsors: { name: string; logo: string | null }[];
  settings: SocialsSettings; look: { vars?: Record<string, string>; light?: boolean;
    template?: { id: string; font?: string; fontCss?: string; script?: string; scriptCss?: string; mark?: string } };
  picked: { home?: { name: string; photo: string }; away?: { name: string; photo: string }; athlete?: { name: string; photo: string } };
  finals: { division: string; finalsNight: boolean; lastRound: boolean; left: number; champion?: string }[];
  byes: { division: string; teams: { name: string; logo: string | null }[] }[];
  countdown: { rounds?: number; grandFinal?: number } | null; raceOn: { division: string; left: number }[]; firstNights: string[];
  met: { id: string; n: number }[]; clubs: { club: string; games: string[] }[];
  streaks: { team: string; division: string; logo: string | null; unbeaten: boolean; won: number; played: number; run: number }[];
  lastNights: string[]; superShotDivisions: string[]; goalOrder: { complete: number; of: number; missing: string[] };
  nextNight: string | null; stories: string[]; storiesFrom: { studio: string; via: string; games: number }[]; ofNight: OfTheNight;
  watchLinks: { name: string; link: string }[];
  lineups?: SocialLineup[]; sponsorList?: { id: string; name: string; tier: string }[];
}
