import React, { useState, useEffect, useRef, useMemo } from 'react';
import './App.css';

const API_BASE = 'https://docusign-production.up.railway.app';

// =========================
// Smart Parsers & Formatters
// =========================

const normalizeText = (raw) => raw.replace(/\s+/g, " ").trim();

function App() {
  const [view, setView] = useState('initial');
  const [filename, setFilename] = useState('');
  const [placeholders, setPlaceholders] = useState([]);
  const [markedHtml, setMarkedHtml] = useState('');
  
  const [canon, setCanon] = useState({});
  const [draft, setDraft] = useState({});
  
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  
  // Guide mode state
  const [isGuideMode, setIsGuideMode] = useState(false);
  const [currentGuidedFieldId, setCurrentGuidedFieldId] = useState(null);
  
  const previewRef = useRef(null);
  const fieldsRef = useRef(null);
  const fileInputRef = useRef(null);
  const chatMessagesRef = useRef(null);

  // Auto-scroll chat to bottom when messages update
  useEffect(() => {
    if (chatMessagesRef.current) {
      chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
    }
  }, [messages]);

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setView('loading');
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(`${API_BASE}/api/upload`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();

      setFilename(data.filename);
      setPlaceholders(data.placeholders);
      setMarkedHtml(data.marked_html || '');
      
      const initialCanon = {};
      const initialDraft = {};
      data.placeholders.forEach(p => {
        initialCanon[p.id] = '';
        initialDraft[p.id] = '';
      });
      setCanon(initialCanon);
      setDraft(initialDraft);

      setMessages([{
        type: 'system',
        text: `Document loaded successfully!\n\nFound ${data.summary.total} fields to fill:\n• ${data.summary.bracketed} bracketed fields\n• ${data.summary.signature_lines} signature lines\n\nStart filling the fields on the left, and watch the preview update in real time!`
      }]);

      setView('app');
    } catch (err) {
      console.error('Upload error:', err);
      setView('initial');
      alert('Upload failed. Please try again.');
    }
  };

  const handleInputChange = (fieldId, rawValue) => {
    setDraft(prev => ({ ...prev, [fieldId]: rawValue }));
    setCanon(prev => ({ ...prev, [fieldId]: normalizeText(rawValue) }));
  };

  const handleInputBlur = (fieldId) => {
    const canonicalValue = canon[fieldId];
    if (!canonicalValue) return;
    setDraft(prev => ({ ...prev, [fieldId]: canonicalValue }));
  };

  // Scroll ONLY to preview (when field card is clicked)
  const scrollToPreview = (fieldId) => {
    if (!previewRef.current) return;
    
    const markerElement = previewRef.current.querySelector(`[data-field-id="${fieldId}"]`);
    if (markerElement) {
      markerElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Flash yellow highlight
      markerElement.style.backgroundColor = '#fef3c7';
      setTimeout(() => {
        markerElement.style.backgroundColor = '';
      }, 1000);
    }
  };

  // Scroll ONLY to field card (when preview is clicked)
  const scrollToFieldCard = (fieldId) => {
    if (!fieldsRef.current) return;
    
    const fieldCard = fieldsRef.current.querySelector(`[data-field-id="${fieldId}"]`);
    if (fieldCard) {
      fieldCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Flash blue border highlight
      fieldCard.style.borderColor = '#6366f1';
      fieldCard.style.boxShadow = '0 0 0 2px rgba(99, 102, 241, 0.3)';
      setTimeout(() => {
        fieldCard.style.borderColor = '';
        fieldCard.style.boxShadow = '';
      }, 1000);
    }
  };

  const getPreviewHtml = useMemo(() => {
    if (!markedHtml) return '';
    
    let html = markedHtml;
    
    placeholders.forEach(placeholder => {
      const fieldId = placeholder.id;
      const marker = `__MARKER_${fieldId}__`;
      const canonValue = canon[fieldId] || '';
      
      if (canonValue) {
        const replacement = `<span class="filled-value" data-field-id="${fieldId}">${canonValue}</span>`;
        html = html.replace(marker, replacement);
      } else {
        const placeholderText = placeholder.label_guess || placeholder.value || placeholder.label || '[Fill this]';
        const replacement = `<span class="field-marker-placeholder" data-field-id="${fieldId}" style="background: #fef3c7; padding: 2px 4px; border-radius: 2px; cursor: pointer;">${placeholderText}</span>`;
        html = html.replace(marker, replacement);
      }
    });
    
    return html;
  }, [markedHtml, placeholders, canon]);

  const handleExport = async () => {
    setIsExporting(true);
    const fieldsData = placeholders.map(p => ({
      ...p,
      input: canon[p.id] || ''
    }));

    try {
      const res = await fetch(`${API_BASE}/api/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename,
          fields: fieldsData,
          also_pdf: false  // We only need DOCX for direct download
        })
      });
      const data = await res.json();
      
      // Immediately download the DOCX file
      if (data.filled_docx_url) {
        const downloadUrl = `${API_BASE}${data.filled_docx_url}`;
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = `${filename.replace('.docx', '')}.filled.docx`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        setMessages(prev => [...prev, {
          type: 'system',
          text: 'Document downloaded successfully! Check your downloads folder.'
        }]);
      }
    } catch (err) {
      console.error('Export error:', err);
      alert('Export failed. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleGuideMe = () => {
    // Find the first unfilled field
    const firstUnfilled = placeholders.find(p => !canon[p.id] || !canon[p.id].trim());
    
    if (!firstUnfilled) {
      setMessages(prev => [...prev, {
        type: 'system',
        text: 'All fields are already filled! Great job! 🎉'
      }]);
      return;
    }

    setIsGuideMode(true);
    setCurrentGuidedFieldId(firstUnfilled.id);
    
    const fieldLabel = firstUnfilled.label_guess || firstUnfilled.value || firstUnfilled.label || 'this field';
    const longHint = firstUnfilled.hint_long || 'Please provide the appropriate information for this field.';
    
    setMessages(prev => [...prev, {
      type: 'assistant',
      text: `Let's fill out the "${fieldLabel}" field.\n\n${longHint}\n\nWhat would you like to enter for ${fieldLabel}?`
    }]);

    // Scroll to the field
    scrollToFieldCard(firstUnfilled.id);
  };

  const handleQuickFillDemo = () => {
    placeholders.forEach(placeholder => {
      const demoValue = placeholder.demo_value || "Sample Text";
      handleInputChange(placeholder.id, demoValue);
      handleInputBlur(placeholder.id);
    });

    setMessages(prev => [...prev, {
      type: 'system',
      text: 'Demo data filled in all fields! You can now edit any field as needed.'
    }]);
  };

  const handleChatSubmit = () => {
    if (!chatInput.trim()) return;
    
    setMessages(prev => [...prev, { type: 'user', text: chatInput }]);
    
    if (isGuideMode && currentGuidedFieldId) {
      // User is answering the guided question
      const userAnswer = chatInput.trim();
      
      // Fill the current guided field
      handleInputChange(currentGuidedFieldId, userAnswer);
      handleInputBlur(currentGuidedFieldId);
      
      setMessages(prev => [...prev, {
        type: 'system',
        text: `Field updated! ✓`
      }]);
      
      // Find the next unfilled field
      const currentIndex = placeholders.findIndex(p => p.id === currentGuidedFieldId);
      const nextUnfilled = placeholders.slice(currentIndex + 1).find(p => !canon[p.id] || !canon[p.id].trim());
      
      if (nextUnfilled) {
        setCurrentGuidedFieldId(nextUnfilled.id);
        
        const fieldLabel = nextUnfilled.label_guess || nextUnfilled.value || nextUnfilled.label || 'this field';
        const longHint = nextUnfilled.hint_long || 'Please provide the appropriate information for this field.';
        
        setTimeout(() => {
          setMessages(prev => [...prev, {
            type: 'assistant',
            text: `Great! Now let's fill out "${fieldLabel}".\n\n${longHint}\n\nWhat would you like to enter for ${fieldLabel}?`
          }]);
          
          // Scroll to the next field
          scrollToFieldCard(nextUnfilled.id);
        }, 500);
      } else {
        setIsGuideMode(false);
        setCurrentGuidedFieldId(null);
        
        setTimeout(() => {
          setMessages(prev => [...prev, {
            type: 'system',
            text: 'All fields are now filled! Great job! 🎉'
          }]);
        }, 500);
      }
    } else {
      // Normal chat
      setTimeout(() => {
        setMessages(prev => [...prev, {
          type: 'assistant',
          text: "I'm here to help you fill out the document. Try clicking 'Guide me' to jump to the next empty field, or ask me about specific fields!"
        }]);
      }, 500);
    }
    
    setChatInput('');
  };

  const completionPercentage = placeholders.length > 0
    ? Math.round((Object.values(canon).filter(v => v && v.trim()).length / placeholders.length) * 100)
    : 0;

  const getInputPlaceholder = (placeholder) => {
    return placeholder.hint || `Enter ${placeholder.label_guess || 'value'}...`;
  };

  if (view === 'initial') {
    return (
      <div className="app-container">
        <div className="initial-screen">
          <div className="initial-content">
            <div className="logo-icon-large">
              <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            
            <h1 className="initial-title">DocuFill AI</h1>
            <p className="initial-subtitle">
              Smart document filling with AI assistance and real-time preview
            </p>

            <div className="upload-zone-large">
              <input
                ref={fileInputRef}
                type="file"
                accept=".docx"
                onChange={handleFileUpload}
                className="hidden-input"
                id="file-upload"
              />
              <label htmlFor="file-upload" className="upload-button-large">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                Upload Document
              </label>
              <p className="upload-hint">Support for .docx files</p>
            </div>

            <div className="features-grid">
              <div className="feature-item">
                <div className="feature-icon">🤖</div>
                <div className="feature-title">AI Assistance</div>
                <p className="feature-description">Get smart suggestions for each field</p>
              </div>
              <div className="feature-item">
                <div className="feature-icon">⚡</div>
                <div className="feature-title">Quick Fill</div>
                <p className="feature-description">Rapidly fill all fields with demo data</p>
              </div>
              <div className="feature-item">
                <div className="feature-icon">👀</div>
                <div className="feature-title">Live Preview</div>
                <p className="feature-description">See changes update in real-time</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'loading') {
    return (
      <div className="app-container">
        <div className="initial-screen">
          <div className="loading-container">
            <div className="spinner"></div>
            <div className="loading-text">Processing your document...</div>
            <div className="loading-subtext">Please wait up to 30 seconds while we analyze the document and generate AI-powered field guidance</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      <div className="app-wrapper">
        {/* Header with Export */}
        <header className="app-header">
          <div className="header-content">
            <div className="logo-section" onClick={() => setView('initial')} style={{ cursor: 'pointer' }}>
              <div className="logo-icon">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div>
                <div className="app-title">DocuFill AI</div>
                <div className="app-subtitle">{filename}</div>
              </div>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div className="completion-badge">
                <span className="completion-value">{completionPercentage}%</span> complete
              </div>
              
              {/* Direct Download Button */}
              <button 
                onClick={handleExport}
                disabled={isExporting}
                className="header-button header-button-primary"
              >
                {isExporting ? (
                  <>
                    <div className="button-spinner"></div>
                    Downloading...
                  </>
                ) : (
                  <>
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ width: '1rem', height: '1rem' }}>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
                    </svg>
                    Download DOCX
                  </>
                )}
              </button>
            </div>
          </div>
        </header>

        <div className="main-grid">
          {/* Fields panel */}
          <div className="panel">
            <div className="panel-header">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
              Detected Fields
            </div>

            {/* Guide Me and Quick-fill Demo Buttons */}
            <div className="guide-buttons-container">
              <button 
                onClick={handleGuideMe}
                className="guide-button guide-button-primary"
              >
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ width: '1.25rem', height: '1.25rem' }}>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                Guide me
              </button>
              <button 
                onClick={handleQuickFillDemo}
                className="guide-button guide-button-secondary"
              >
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ width: '1.25rem', height: '1.25rem' }}>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Quick-fill demo
              </button>
            </div>
            
            <div className="panel-content" ref={fieldsRef}>
              <div className="fields-container">
                {placeholders.map((placeholder, idx) => {
                  return (
                    <div 
                      key={placeholder.id} 
                      data-field-id={placeholder.id}
                      className="field-card"
                      onClick={() => scrollToPreview(placeholder.id)}
                      style={{ cursor: 'pointer' }}
                    >
                      <div className="field-card-header">
                        <div className="field-name-row">
                          <span className="field-label">
                            {placeholder.label_guess || placeholder.value || placeholder.label}
                          </span>
                          {canon[placeholder.id] && (
                            <span className="filled-badge">
                              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                              Filled
                            </span>
                          )}
                        </div>
                        <span className="field-line">Line {placeholder.line}</span>
                      </div>
                      
                      {placeholder.hint && (
                        <div className="field-hint">💡 {placeholder.hint}</div>
                      )}
                      
                      <div className="field-input-wrapper">
                        <input
                          type="text"
                          className="field-input"
                          placeholder={getInputPlaceholder(placeholder)}
                          value={draft[placeholder.id] || ''}
                          onChange={(e) => handleInputChange(placeholder.id, e.target.value)}
                          onBlur={() => handleInputBlur(placeholder.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Chat panel - moved to middle */}
          <div className="panel">
            <div className="panel-header">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
              AI Assistant
            </div>
            
            <div className="panel-content">
              <div className="chat-panel-content">
                <div className="chat-messages" ref={chatMessagesRef}>
                  {messages.map((msg, idx) => (
                    <div key={idx} className={`message message-${msg.type}`}>
                      {msg.text}
                    </div>
                  ))}
                </div>
                
                <div className="chat-input-container">
                  <input
                    type="text"
                    className="chat-input"
                    placeholder="Ask the AI for help..."
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleChatSubmit()}
                  />
                  <button 
                    onClick={handleChatSubmit}
                    className="send-button"
                    disabled={!chatInput.trim()}
                  >
                    Send
                  </button>
                </div>
                
                <p className="chat-hint">
                  💡 Tip: Click 'Guide me' to fill fields step-by-step!
                </p>
              </div>
            </div>
          </div>

          {/* Preview panel - moved to right */}
          <div className="panel">
            <div className="panel-header">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              Live Preview
            </div>
            
            <div className="panel-content">
              <div className="preview-stats">
                <div className="stat">
                  <span className="stat-value">{placeholders.length}</span>
                  <span className="stat-label">Total Fields</span>
                </div>
                <div className="stat">
                  <span className="stat-value">{Object.values(canon).filter(v => v && v.trim()).length}</span>
                  <span className="stat-label">Filled</span>
                </div>
                <div className="stat">
                  <span className="stat-value">{placeholders.length - Object.values(canon).filter(v => v && v.trim()).length}</span>
                  <span className="stat-label">Remaining</span>
                </div>
              </div>

              <div 
                ref={previewRef}
                className="document-preview"
              >
                <div 
                  className="document-html-content"
                  dangerouslySetInnerHTML={{ __html: getPreviewHtml }}
                  onClick={(e) => {
                    const target = e.target;
                    if (target.dataset.fieldId) {
                      scrollToFieldCard(target.dataset.fieldId);
                    }
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
