import { useState } from 'react'
import WordSpirit from './WordSpirit'
import IslandScene from './IslandScene'
import { speakWord, triggerHaptic } from '../utils/audio'

// Three fixed D1 words. This public introduction never writes grades or rewards.
const FIRST_WORDS = [
  { word: 'make', meaning: '制造，做，建造', options: ['制造，做，建造', '苹果', '星期天', '蓝色'], correct: 0 },
  { word: 'play', meaning: '玩，打（球），演奏', options: ['医院', '玩，打（球），演奏', '明天', '高山'], correct: 1 },
  { word: 'learn', meaning: '学习，学会', options: ['冰箱', '轮船', '学习，学会', '下雨'], correct: 2 },
]
const INTRO_KEY = 'wordcamp:first-wake:v1'
export function hasTriedFirstWake(): boolean {
  try { return localStorage.getItem(INTRO_KEY) === 'done' } catch { return false }
}

export default function FirstWakeExperience({ onFinish }: { onFinish: () => void }) {
  const [step, setStep] = useState<'egg' | 'question' | 'hatched' | 'done'>('egg')
  const [index, setIndex] = useState(0)
  const [wrong, setWrong] = useState<number | null>(null)
  const current = FIRST_WORDS[index]

  function choose(option: number) {
    if (step !== 'question') return
    if (option !== current.correct) { setWrong(option); return }
    setWrong(null)
    setStep('hatched')
    triggerHaptic(12)
  }

  function next() {
    if (index === FIRST_WORDS.length - 1) {
      setStep('done')
      try { localStorage.setItem(INTRO_KEY, 'done') } catch { /* usable without storage */ }
    } else {
      setIndex(index + 1)
      setStep('question')
    }
  }

  if (step === 'done') return (
    <section className="world-intro" aria-labelledby="intro-title">
      <IslandScene lit spirits={FIRST_WORDS.map((w) => ({ word: w.word, bestStage: 1 }))} />
      <h2 id="intro-title">第一簇篝火，亮了。</h2>
      <p>今天的初次见面到这里。明天，艾斯会带你看看哪只词灵想再听一遍自己的名字。</p>
      <p className="world-muted">已体验唤醒 3 只词灵。登录班级账号后，正式保存学习进度与家园。</p>
      <button type="button" className="camp-btn camp-btn-berry" onClick={onFinish}>登录，安放我的营地</button>
      <small className="world-muted">提醒由你决定，登录后可在「我的」设置。</small>
    </section>
  )

  return (
    <section className="world-intro" aria-labelledby="intro-title">
      {step === 'egg' ? <>
        <IslandScene />
        <h2 id="intro-title">它在等你喊出它的名字。</h2>
        <p>海雾里，藏着一只忘了名字的词灵。</p>
        <button type="button" className="camp-btn camp-btn-berry world-wake-button" onClick={() => { setStep('question'); speakWord(current.word) }}>唤醒</button>
        <small className="world-muted">先认识 3 只词灵 · 无需登录即可体验</small>
      </> : <>
        <div className="world-intro-heading"><span className="badge badge-blue">初次邂逅 · {index + 1} / 3</span><button type="button" className="candy-pill" onClick={() => speakWord(current.word)}>听读音</button></div>
        <WordSpirit word={current.word} bestStage={step === 'hatched' ? 1 : 0} size={120} celebrate={step === 'hatched'} />
        <h2 id="intro-title" className="camp-word-title">{current.word}</h2>
        {step === 'question' ? <>
          <p>选出它的意思，帮它记起名字。</p>
          <div className="world-answer-grid">
            {current.options.map((option, i) => <button type="button" key={option} disabled={wrong === i} className="camp-btn" onClick={() => choose(i)}>{option}</button>)}
          </div>
          <div className="world-intro-feedback" role="status">{wrong !== null ? '雾还没散开，换一个试试。' : '不用赶时间，慢慢想。'}</div>
        </> : <>
          <p role="status"><strong>「{current.meaning}」——你叫醒它了！</strong></p>
          <p className="world-muted">{index === 1 ? '我是艾斯。灯越亮，名字记得越牢。' : index === 2 ? '三只词灵聚在一起，准备点燃篝火。' : '它抖掉了身上的雾，向你眨眨眼。'}</p>
          <button type="button" className="camp-btn camp-btn-mint" onClick={next}>{index === 2 ? '一起点燃篝火' : '认识下一只'}</button>
        </>}
      </>}
    </section>
  )
}
