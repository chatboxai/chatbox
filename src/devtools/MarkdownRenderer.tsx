import React, { useEffect, useRef, useState } from 'react';
import { Box } from '@mui/material';
import { IconButton, Tooltip } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import { styled } from '@mui/material/styles';

const CodeBlockWrapper = styled('div')(({ theme }) => ({
  position: 'relative',
  display: 'inline-block',
  width: '100%',
  '&:hover .copy-button': {
    opacity: 1,
    visibility: 'visible',
  },
}));

const CopyButtonOverlay = styled(IconButton)(({ theme }) => ({
  position: 'absolute',
  top: theme.spacing(1),
  right: theme.spacing(1),
  backgroundColor: theme.palette.background.paper,
  color: theme.palette.text.primary,
  opacity: 0,
  visibility: 'hidden',
  transition: 'opacity 0.2s ease-in-out, visibility 0.2s ease-in-out',
  zIndex: 10,
  boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
  '&:hover': {
    backgroundColor: theme.palette.action.hover,
  },
  '&.copied': {
    color: theme.palette.success.main,
  },
}));

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, className }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [copiedStates, setCopiedStates] = useState<{ [key: string]: boolean }>({});

  useEffect(() => {
    if (containerRef.current) {
      // Find all code block wrappers and add copy buttons
      const codeWrappers = containerRef.current.querySelectorAll('.code-block-wrapper');
      codeWrappers.forEach((wrapper, index) => {
        const codeElement = wrapper.querySelector('code');
        if (codeElement && !wrapper.hasAttribute('data-copy-processed')) {
          const codeText = codeElement.textContent || '';
          const wrapperId = `code-block-${index}`;
          
          // Create copy button
          const copyButton = document.createElement('div');
          copyButton.className = 'copy-button';
          copyButton.innerHTML = `
            <button style="
              position: absolute;
              top: 8px;
              right: 8px;
              background: white;
              border: 1px solid #ccc;
              border-radius: 4px;
              padding: 4px 8px;
              cursor: pointer;
              opacity: 0;
              visibility: hidden;
              transition: opacity 0.2s ease-in-out, visibility 0.2s ease-in-out;
              z-index: 10;
              display: flex;
              align-items: center;
              gap: 4px;
              font-size: 12px;
            " data-code-text="${codeText.replace(/"/g, '&quot;')}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
              </svg>
              Copy
            </button>
          `;
          
          wrapper.appendChild(copyButton);
          wrapper.setAttribute('data-copy-processed', 'true');
          wrapper.setAttribute('data-wrapper-id', wrapperId);
          
          // Add hover effect
          wrapper.style.position = 'relative';
          wrapper.style.display = 'inline-block';
          wrapper.style.width = '100%';
        }
      });
      
      // Add event listeners for copy buttons
      const copyButtons = containerRef.current.querySelectorAll('.copy-button button');
      copyButtons.forEach((button) => {
        button.addEventListener('click', async (e) => {
          e.preventDefault();
          const target = e.target as HTMLElement;
          const codeText = target.getAttribute('data-code-text') || '';
          const wrapper = target.closest('.code-block-wrapper');
          const wrapperId = wrapper?.getAttribute('data-wrapper-id') || '';
          
          try {
            await navigator.clipboard.writeText(codeText);
            setCopiedStates(prev => ({ ...prev, [wrapperId]: true }));
            
            // Update button appearance
            target.innerHTML = `
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
              </svg>
              Copied!
            `;
            target.style.color = '#4caf50';
            
            // Reset after 2 seconds
            setTimeout(() => {
              setCopiedStates(prev => ({ ...prev, [wrapperId]: false }));
              target.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
                </svg>
                Copy
              `;
              target.style.color = '';
            }, 2000);
          } catch (err) {
            console.error('Failed to copy text: ', err);
          }
        });
      });
    }
  }, [content]);

  return (
    <Box
      ref={containerRef}
      className={className}
      dangerouslySetInnerHTML={{ __html: content }}
      sx={{
        '& .code-block-wrapper': {
          position: 'relative',
          display: 'inline-block',
          width: '100%',
          '&:hover .copy-button button': {
            opacity: 1,
            visibility: 'visible',
          },
        },
      }}
    />
  );
};

export default MarkdownRenderer;
