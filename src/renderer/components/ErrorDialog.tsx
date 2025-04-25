import React from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogContentText,
    DialogActions,
    Button,
} from '@mui/material';

interface ErrorDialogProps {
    open: boolean;
    title?: string;
    message: string;
    actions?: React.ReactNode;
    onClose: () => void;
}

const ErrorDialog: React.FC<ErrorDialogProps> = ({
                                                     open,
                                                     title = 'Error',
                                                     message,
                                                     actions,
                                                     onClose,
                                                 }) => {
    return (
        <Dialog
            open={open}
            onClose={onClose}
            aria-labelledby="alert-dialog-title"
            aria-describedby="alert-dialog-description"
        >
            <DialogTitle id="alert-dialog-title">{title}</DialogTitle>

            <DialogContent>
                <DialogContentText id="alert-dialog-description">
                    {message}
                </DialogContentText>
            </DialogContent>

            <DialogActions>
                {actions || (
                    <Button onClick={onClose} color="primary" autoFocus>
                        OK
                    </Button>
                )}
            </DialogActions>
        </Dialog>
    );
};

export default ErrorDialog;