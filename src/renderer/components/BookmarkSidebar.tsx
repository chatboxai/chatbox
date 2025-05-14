import React from 'react'
import { Box, Drawer, List, ListItem, ListItemText, IconButton, Typography, useTheme } from '@mui/material'
import BookmarkIcon from '@mui/icons-material/Bookmark'
import DeleteIcon from '@mui/icons-material/Delete'
import { useTranslation } from 'react-i18next'
import { useAtom } from 'jotai'
import { bookmarksAtom, Bookmark } from '../stores/atoms'
import * as scrollActions from '../stores/scrollActions'
import * as toastActions from '../stores/toastActions'

interface Props {
  open: boolean
  onClose: () => void
}

export default function BookmarkSidebar({ open, onClose }: Props) {
  const { t } = useTranslation()
  const theme = useTheme()
  const [bookmarks, setBookmarks] = useAtom(bookmarksAtom)

  const handleBookmarkClick = (messageId: string) => {
    scrollActions.scrollToMessage(messageId, 'center')
    onClose()
  }

  const handleDeleteBookmark = (messageId: string) => {
    setBookmarks((prev: Bookmark[]) => {
      const newBookmarks = prev.filter((b: Bookmark) => b.messageId !== messageId)
      toastActions.add(t('Bookmark removed'))
      return newBookmarks
    })
  }

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      variant="temporary"
      sx={{
        '& .MuiDrawer-paper': {
          width: 320,
          backgroundColor: theme.palette.background.paper,
          boxShadow: theme.shadows[4],
          borderLeft: `1px solid ${theme.palette.divider}`,
          height: '100%',
          position: 'fixed',
          top: 0,
          right: 0,
          zIndex: theme.zIndex.drawer + 1,
        },
      }}
    >
      <Box sx={{ p: 2, borderBottom: `1px solid ${theme.palette.divider}` }}>
        <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <BookmarkIcon />
          {t('Bookmarks')}
        </Typography>
      </Box>
      <List sx={{ overflow: 'auto', height: 'calc(100% - 64px)' }}>
        {bookmarks.length === 0 ? (
          <ListItem>
            <ListItemText primary={t('No bookmarks yet')} />
          </ListItem>
        ) : (
          [...bookmarks]
            .sort((a, b) => b.timestamp - a.timestamp)
            .map((bookmark: Bookmark) => (
              <ListItem
                key={bookmark.messageId}
                sx={{
                  borderBottom: `1px solid ${theme.palette.divider}`,
                  '&:hover': {
                    backgroundColor: theme.palette.action.hover,
                  },
                  cursor: 'pointer',
                }}
              >
                <ListItemText
                  primary={bookmark.title || t('Untitled Bookmark')}
                  secondary={new Date(bookmark.timestamp).toLocaleString()}
                  onClick={() => handleBookmarkClick(bookmark.messageId)}
                  sx={{ 
                    cursor: 'pointer',
                    '&:hover': {
                      color: theme.palette.primary.main,
                    }
                  }}
                />
                <IconButton
                  edge="end"
                  aria-label="delete"
                  onClick={() => handleDeleteBookmark(bookmark.messageId)}
                  size="small"
                  sx={{
                    '&:hover': {
                      color: theme.palette.error.main,
                    }
                  }}
                >
                  <DeleteIcon />
                </IconButton>
              </ListItem>
            ))
        )}
      </List>
    </Drawer>
  )
} 