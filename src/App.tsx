import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Navigate, Route, Routes } from 'react-router-dom'
import { supabase } from './lib/supabaseClient'
import { Account } from './pages/Account'
import { Home } from './pages/Home'
import { ImageEdit } from './pages/ImageEdit'
import { Video } from './pages/Video'

function AuthRoute({ session, children }: { session: Session | null; children: JSX.Element }) {
  if (!session) return <Navigate to='/' replace />
  return children
}

export function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(!supabase)
  const [showServiceMigration, setShowServiceMigration] = useState(true)

  useEffect(() => {
    const showNotice = () => setShowServiceMigration(true)
    window.addEventListener('orca:show-service-migration', showNotice)
    return () => window.removeEventListener('orca:show-service-migration', showNotice)
  }, [])

  useEffect(() => {
    if (!supabase) {
      setAuthReady(true)
      return
    }

    const supabaseClient = supabase
    let isCancelled = false

    const applyHashSession = async () => {
      if (typeof window === 'undefined') return
      const rawHash = window.location.hash
      if (!rawHash || !rawHash.includes('access_token=')) return

      const hashParams = new URLSearchParams(rawHash.startsWith('#') ? rawHash.slice(1) : rawHash)
      const accessToken = hashParams.get('access_token')
      const refreshToken = hashParams.get('refresh_token')
      if (!accessToken || !refreshToken) return

      const { data, error } = await supabaseClient.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      })
      if (error || isCancelled) return

      setSession(data.session ?? null)
      const url = new URL(window.location.href)
      url.hash = ''
      window.history.replaceState({}, document.title, url.toString())
    }

    void applyHashSession()

    supabaseClient.auth.getSession().then(({ data }) => {
      if (isCancelled) return
      setSession(data.session ?? null)
      setAuthReady(true)
    })

    const {
      data: { subscription },
    } = supabaseClient.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setAuthReady(true)
    })

    return () => {
      isCancelled = true
      subscription.unsubscribe()
    }
  }, [])

  if (!authReady) return null

  return (
    <>
    <Routes>
      <Route path='/' element={session ? <Video /> : <Home />} />
      <Route path='/video' element={<Navigate to='/' replace />} />
      <Route path='/image-edit' element={<AuthRoute session={session}><ImageEdit /></AuthRoute>} />
      <Route path='/account' element={<AuthRoute session={session}><Account /></AuthRoute>} />
      <Route path='*' element={<Navigate to='/' replace />} />
    </Routes>
    {showServiceMigration && (
      <div className='service-migration-backdrop' role='presentation'>
        <section className='service-migration-dialog' role='dialog' aria-modal='true' aria-labelledby='service-migration-title'>
          <button type='button' className='service-migration-close' aria-label='閉じる' onClick={() => setShowServiceMigration(false)}>&times;</button>
          <span className='service-migration-badge'>IMPORTANT NOTICE</span>
          <h2 id='service-migration-title'>サービス統合のお知らせ</h2>
          <p>当サービスおよび関連APIを提供していた各サイトは、新サービス<strong>「ComfyHost」</strong>へ統合されました。</p>
          <p>移行基準日時点の未使用トークンは、ComfyHostへログインすると対象サイト分を合算して引き継ぎます。これまでと同じGoogleアカウントでログインしてください。</p>
          <p>新サービスでは、ワークフローやモデルを自由に組み合わせられる、より柔軟なGPU環境を提供します。</p>
          <div className='service-migration-workflows'>
            <strong>すぐに試せるサンプルワークフロー</strong>
            <a href='/samples/video_wan2_2_14B_i2v.json' download>動画生成サンプル</a>
            <a href='/samples/video_ltx2_3_i2v.json' download>動画・音声生成サンプル</a>
            <a href='/samples/Qwen-Rapid-AIO.json' download>画像編集サンプル</a>
          </div>
          <div className='service-migration-actions'>
            <a href='https://comfy-host.com' className='service-migration-primary'>ComfyHostへ移動</a>
            <button type='button' onClick={() => setShowServiceMigration(false)}>閉じる</button>
          </div>
        </section>
      </div>
    )}
    </>
  )
}
