import React, { useState, useRef, useEffect } from 'react';
import { IconButton, Tooltip, Snackbar, Alert } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import { styled } from '@mui/material/styles';

const CopyButtonContainer = styled('div')(({ theme }) => ({
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
  '&:hover': {
    backgroundColor: theme.palette.action.hover,
  },
  '&.copied': {
    color: theme.palette.success.main,
  },
}));

interface CopyButtonProps {
  content: string;
  className?: string;
}

export const CopyButton: React.FC<CopyButtonProps> = ({ content, className = '' }) => {
  const [copied, setCopied] = useState(false);
  const [showSnackbar, setShowSnackbar] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setShowSnackbar(true);
      
      // Reset the copied state after 2 seconds
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = content;
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        setShowSnackbar(true);
        setTimeout(() => {
          setCopied(false);
        }, 2000);
      } catch (fallbackErr) {
        console.error('Fallback copy failed: ', fallbackErr);
      }
      document.body.removeChild(textArea);
    }
  };

  const handleSnackbarClose = () => {
    setShowSnackbar(false);
  };

  return (
    <>
      <CopyButtonContainer ref={containerRef} className={className}>
        <CopyButtonOverlay
          className={`copy-button ${copied ? 'copied' : ''}`}
          onClick={handleCopy}
          size="small"
        >
          {copied ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
        </CopyButtonOverlay>
        <Snackbar
          open={showSnackbar}
          autoHideDuration={2000}
          onClose={handleSnackbarClose}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        >
          <Alert onClose={handleSnackbarClose} severity="success" sx={{ width: '100%' }}>
            Copied to clipboard!
          </Alert>
        </Snackbar>
      </CopyButtonContainer>
    </>
  );
};

export default CopyButton;
