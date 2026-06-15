import { useCallback, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabaseClient'
import './home.css'

const HERO_VIDEO_SRC = '/lp/hero-banner.webm?v=loop3'

const loraLabels = [
  '片足上げ',
  '首掴み跪き',
  '硝子接吻',
  '俯せ後背位',
  '画面水飛沫',
  '顔面衝撃',
  '濃厚接吻',
  '抱上げ後背位',
  '手口連携',
  '一人称乳交',
  '射精演出 1',
  '射精演出 2',
  '射精演出 3',
  '射精演出 4',
  '一人称正常位',
  '小便',
  '瞬間切替乳交 1',
  '瞬間切替乳交 2',
  '瞬間切替背面後背位 1',
  '瞬間切替背面後背位 2',
  '瞬間切替顔射 1',
  '瞬間切替顔射 2',
  '瞬間切替正面後背位 1',
  '瞬間切替正面後背位 2',
  '瞬間切替正面後背位 3',
  '瞬間切替手交 1',
  '瞬間切替手交 2',
  '瞬間切替手交 3',
  '瞬間切替口交',
  '瞬間切替正常位 1',
  '瞬間切替正常位 2',
  '瞬間切替正常位 3',
  '瞬間切替屈み女上位 1',
  '瞬間切替屈み女上位 2',
  '側位姿勢',
]

export function Home() {
  const heroVideoRef = useRef<HTMLVideoElement | null>(null)

  const handleGoogleSignIn = useCallback(async () => {
    if (!supabase) return
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
      },
    })
  }, [])

  const replayHeroVideo = useCallback(() => {
    const video = heroVideoRef.current
    if (!video) return
    try {
      video.currentTime = 0
    } catch {
      video.load()
    }
    void video.play().catch(() => undefined)
  }, [])

  const loopHeroVideoIfNeeded = useCallback(() => {
    const video = heroVideoRef.current
    if (!video) return
    const duration = video.duration
    if (!Number.isFinite(duration) || duration <= 0) return
    if (video.currentTime < Math.max(0, duration - 0.22)) return
    replayHeroVideo()
  }, [replayHeroVideo])

  useEffect(() => {
    const video = heroVideoRef.current
    if (!video) return

    video.muted = true
    video.defaultMuted = true
    video.loop = true
    video.playsInline = true
    video.setAttribute('muted', '')
    video.setAttribute('playsinline', '')
    video.setAttribute('webkit-playsinline', '')

    const handleEnded = () => replayHeroVideo()
    const handleTimeUpdate = () => loopHeroVideoIfNeeded()
    const handlePause = () => {
      if (video.ended) replayHeroVideo()
    }
    const intervalId = window.setInterval(loopHeroVideoIfNeeded, 250)

    video.addEventListener('ended', handleEnded)
    video.addEventListener('timeupdate', handleTimeUpdate)
    video.addEventListener('pause', handlePause)
    void video.play().catch(() => undefined)

    return () => {
      window.clearInterval(intervalId)
      video.removeEventListener('ended', handleEnded)
      video.removeEventListener('timeupdate', handleTimeUpdate)
      video.removeEventListener('pause', handlePause)
    }
  }, [loopHeroVideoIfNeeded, replayHeroVideo])

  return (
    <main className="lp-page">
      <header className="lp-header">
        <a className="lp-brand" href="/" aria-label="OrcaAI">
          <img src="/orca-header-icon.png" alt="" aria-hidden="true" />
          <span>OrcaAI</span>
        </a>
        <button className="lp-login-button" type="button" onClick={handleGoogleSignIn}>
          ログイン / 無料登録
        </button>
      </header>

      <section className="lp-hero">
        <video
          ref={heroVideoRef}
          className="lp-hero__video"
          src={HERO_VIDEO_SRC}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          onEnded={replayHeroVideo}
        />
        <div className="lp-hero__shade" aria-hidden="true" />
        <div className="lp-hero__content">
          <p className="lp-eyebrow">High Quality AI Video Studio</p>
          <h1>OrcaAI</h1>
          <p className="lp-lede">
            顔写真から高画質なAI動画を高速生成。LoRAモーション、sound追加、画像編集、角度変更までひとつの画面で扱えます。
          </p>
          <div className="lp-hero__actions">
            <button className="lp-primary" type="button" onClick={handleGoogleSignIn}>
              ログイン / 無料登録
            </button>
            <span>登録後すぐに無料チケットで試せます</span>
          </div>
        </div>
      </section>

      <section className="lp-band lp-band--stats" aria-label="OrcaAI features">
        <div className="lp-stat">
          <strong>高速生成</strong>
          <span>短時間でプレビューまで到達しやすい生成導線。</span>
        </div>
        <div className="lp-stat">
          <strong>高画質</strong>
          <span>滑らかな動画表現と鮮明な質感。</span>
        </div>
        <div className="lp-stat">
          <strong>無料登録</strong>
          <span>登録時に無料チケットを付与。</span>
        </div>
        <div className="lp-stat">
          <strong>12時間ボーナス</strong>
          <span>ログイン後、12時間ごとにボーナスを受け取り可能。</span>
        </div>
      </section>

      <section className="lp-section lp-section--split">
        <div className="lp-copy">
          <p className="lp-eyebrow">Motion LoRA</p>
          <h2>動きだけを選べるLoRAモーション</h2>
          <p>
            プロンプトを書かなくても、使いたい動きを選ぶだけで生成できます。複数のLoRAを重ねて、動きや演出の方向性を細かく調整できます。
          </p>
        </div>
        <figure className="lp-media-card">
          <video src="/lp/lora-leg-example.mp4" autoPlay muted loop playsInline controls />
          <figcaption>LoRA使用例: 片足上げ</figcaption>
        </figure>
      </section>

      <section className="lp-section">
        <div className="lp-section__header">
          <p className="lp-eyebrow">LoRA Library</p>
          <h2>対応LoRA一覧</h2>
          <p>生成画面で強さをスライダー調整できます。0.1以上で適用、1.0から1.5が目安です。</p>
        </div>
        <div className="lp-lora-grid">
          {loraLabels.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
      </section>

      <section className="lp-section lp-section--edit">
        <div className="lp-section__header">
          <p className="lp-eyebrow">Image Edit</p>
          <h2>画像編集と角度変更も同じアカウントで</h2>
          <p>服装や質感の変更、カメラアングルの変更をプロンプトやプリセットで実行できます。</p>
        </div>

        <div className="lp-showcase-grid">
          <article className="lp-showcase">
            <div className="lp-before-after">
              <img src="/lp/shell-bikini-source.webp" alt="元画像" />
              <img src="/lp/shell-bikini-edit.png" alt="画像編集結果" />
            </div>
            <div>
              <strong>画像編集</strong>
              <p>命令: ビキニを貝殻にして</p>
            </div>
          </article>
          <article className="lp-showcase">
            <img src="/lp/low-angle-edit.png" alt="下からのアングル変更結果" />
            <div>
              <strong>角度変更</strong>
              <p>プリセット: Low Angle。下からのアングルに変更。</p>
            </div>
          </article>
        </div>
      </section>

      <section className="lp-final">
        <p className="lp-eyebrow">Start Free</p>
        <h2>無料登録でOrcaAIを試す</h2>
        <p>動画生成、LoRA、sound、画像編集をひとつのアカウントで利用できます。</p>
        <button className="lp-primary" type="button" onClick={handleGoogleSignIn}>
          ログイン / 無料登録
        </button>
      </section>
    </main>
  )
}
