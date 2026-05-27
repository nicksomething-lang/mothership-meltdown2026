import mothershipLogo from './assets/mothership.jpg';
import { useState, useRef, useCallback } from 'react'
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import {
  arrayMove, SortableContext, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { supabase } from './supabaseClient'
import { EVENT_CODE, EVENT_NAME, CATEGORIES } from './config'

function AppLayout({ children }) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <img src={mothershipLogo} alt="Mothership Meltdown 2026" className="app-logo" />
      </header>
      <main>{children}</main>
    </div>
  )
}

export default function App() {
  const [step, setStep] = useState('code')
  const [judgeCode, setJudgeCode] = useState('')
  const [judgeName, setJudgeName] = useState('')
  const [ranking, setRanking] = useState([])
  const [notes, setNotes] = useState({})
  const [submittedAt, setSubmittedAt] = useState(null)
  const [saveStatus, setSaveStatus] = useState('idle')
  const [error, setError] = useState('')

  const handleCodeSubmit = async () => {
    setError('')
    const code = judgeCode.trim()
    if (!code) return
    const { data, error: dbErr } = await supabase
      .from('ranking_submissions')
      .select('*')
      .eq('event_code', EVENT_CODE)
      .eq('judge_code', code)
      .maybeSingle()
    if (dbErr || !data) {
      setError('Code not recognized. Check with the event organizer.')
      return
    }
    setRanking(data.ranking || [])
    setNotes(data.notes || {})
    setSubmittedAt(data.submitted_at)
    if (data.submitted_at) {
      setJudgeName(data.judge_name || '')
      setStep('submitted')
    } else if (!data.judge_name) {
      setStep('name')
    } else {
      setJudgeName(data.judge_name)
      setStep('rank')
    }
  }

  const handleNameSubmit = async () => {
    const name = judgeName.trim()
    if (!name) return
    const { error: dbErr } = await supabase
      .from('ranking_submissions')
      .update({ judge_name: name, last_updated: new Date().toISOString() })
      .eq('event_code', EVENT_CODE)
      .eq('judge_code', judgeCode)
    if (dbErr) { setError('Could not save name. Try again.'); return }
    setStep('rank')
  }

  const saveTimer = useRef(null)
  const saveToSupabase = useCallback(async (newRanking, newNotes) => {
    setSaveStatus('saving')
    const { error: dbErr } = await supabase
      .from('ranking_submissions')
      .update({
        ranking: newRanking,
        notes: newNotes,
        last_updated: new Date().toISOString(),
      })
      .eq('event_code', EVENT_CODE)
      .eq('judge_code', judgeCode)
    setSaveStatus(dbErr ? 'error' : 'saved')
  }, [judgeCode])

  const scheduleSave = useCallback((newRanking, newNotes) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => saveToSupabase(newRanking, newNotes), 600)
  }, [saveToSupabase])

  const handleDragEnd = (event) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setRanking((prev) => {
      const oldIdx = prev.indexOf(active.id)
      const newIdx = prev.indexOf(over.id)
      const next = arrayMove(prev, oldIdx, newIdx)
      scheduleSave(next, notes)
      return next
    })
  }

  const handleNotesUpdate = (entryNum, updatedEntryNotes) => {
    setNotes((prev) => {
      const next = { ...prev, [entryNum]: updatedEntryNotes }
      scheduleSave(ranking, next)
      return next
    })
  }

  const handleSubmit = async () => {
    const ok = window.confirm('Submit your final rankings? You will not be able to edit after this.')
    if (!ok) return
    const { error: dbErr } = await supabase
      .from('ranking_submissions')
      .update({
        submitted_at: new Date().toISOString(),
        ranking, notes,
        last_updated: new Date().toISOString(),
      })
      .eq('event_code', EVENT_CODE)
      .eq('judge_code', judgeCode)
    if (dbErr) { setError('Submit failed. Try again.'); return }
    setSubmittedAt(new Date().toISOString())
    setStep('submitted')
  }

  if (step === 'code') return (
    <AppLayout>
      <div className="screen">
        <p className="muted">Enter your official judge code to begin:</p>
        <input
          type="text"
          className="input"
          placeholder="Judge Code"
          value={judgeCode}
          onChange={(e) => setJudgeCode(e.target.value)}
        />
        <button className="btn-primary" onClick={handleCodeSubmit}>
          Enter
        </button>
        {error && <div className="error">{error}</div>}
      </div>
    </AppLayout>
  )

  if (step === 'name') return (
    <AppLayout>
      <div className="screen">
        <p className="muted">Please enter your name for this judging session:</p>
        <input
          type="text"
          className="input"
          placeholder="Your Name"
          value={judgeName}
          onChange={(e) => setJudgeName(e.target.value)}
        />
        <button className="btn-primary" onClick={handleNameSubmit}>
          Continue to Rankings
        </button>
        {error && <div className="error">{error}</div>}
      </div>
    </AppLayout>
  )

  if (step === 'submitted') return (
    <AppLayout>
      <div className="screen">
        <h2>Submission Received</h2>
        <p className="muted">Thank you, {judgeName}. Your final rankings have been locked and submitted.</p>
      </div>
    </AppLayout>
  )

  return (
    <AppLayout>
      <RankingScreen judgeName={judgeName} ranking={ranking} notes={notes}
        onDragEnd={handleDragEnd} onNotesUpdate={handleNotesUpdate}
        onSubmit={handleSubmit} saveStatus={saveStatus} />
    </AppLayout>
  )
}

function RankingScreen({ judgeName, ranking, notes, onDragEnd, onNotesUpdate, onSubmit, saveStatus }) {
  const [openEntry, setOpenEntry] = useState(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  )

  return (
    <div className="rank-screen">
      <header className="rank-header">
        <div>
          <div className="judge-name">{judgeName}</div>
          <div className="save-status">{saveStatusLabel(saveStatus)}</div>
        </div>
        <button className="btn-submit" onClick={onSubmit}>Submit</button>
      </header>
      <p className="muted small">Long-press the handle (⋮⋮) to drag. Tap the note icon to add notes.</p>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ranking} strategy={verticalListSortingStrategy}>
          <ul className="rank-list">
            {ranking.map((entryNum, idx) => (
              <SortableEntry key={entryNum} id={entryNum} position={idx + 1}
                hasNotes={hasAnyNote(notes[entryNum])}
                onTap={() => setOpenEntry(entryNum)} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      {openEntry !== null && (
        <EntryModal entryNum={openEntry} notes={notes[openEntry] || {}}
          onClose={() => setOpenEntry(null)}
          onSave={(updated) => onNotesUpdate(openEntry, updated)} />
      )}
    </div>
  )
}

function SortableEntry({ id, position, hasNotes, onTap }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }
  return (
    <li ref={setNodeRef} style={style} className="rank-item">
      <span className="drag-handle" {...attributes} {...listeners} aria-label="Drag to reorder">⋮⋮</span>
      <span className="position">{position}</span>
      <span className="entry-num">Entry #{id}</span>
      <button className="notes-btn" onClick={onTap} aria-label="Add notes">
        {hasNotes ? '📝' : '＋'}
      </button>
    </li>
  )
}

function EntryModal({ entryNum, notes, onClose, onSave }) {
  const [local, setLocal] = useState(notes)
  const updateField = (key, value) => {
    const next = { ...local, [key]: value }
    setLocal(next)
    onSave(next)
  }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        
        {/* Added Modal Header with Title and "X" Close Button */}
        <div className="modal-header">
          <span className="modal-title">Entry #{entryNum}</span>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close modal">
            &times;
          </button>
        </div>

        <div className="modal-body">
          {CATEGORIES.map((cat) => (
            <div key={cat.key} className="category-block">
              <label className="cat-label">{cat.label}</label>
              <p className="cat-desc">{cat.description}</p>
              <textarea className="cat-notes" value={local[cat.key] || ''}
                onChange={(e) => updateField(cat.key, e.target.value)}
                placeholder="Your notes..." rows={3} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function hasAnyNote(entryNotes) {
  if (!entryNotes) return false
  return Object.values(entryNotes).some((v) => v && v.trim().length > 0)
}

function saveStatusLabel(status) {
  switch (status) {
    case 'saving': return 'Saving…'
    case 'saved': return 'Saved ✓'
    case 'error': return 'Save failed — check connection'
    default: return ''
  }
}