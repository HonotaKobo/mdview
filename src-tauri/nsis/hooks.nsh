; Add tsumugi install directory to user PATH on install
!macro NSIS_HOOK_POSTINSTALL
  nsExec::ExecToLog "powershell.exe -NoProfile -Command $\"$$p=[Environment]::GetEnvironmentVariable('Path','User');if(-not $$p){$$p=''};if(($$p -split ';') -notcontains '$INSTDIR'){[Environment]::SetEnvironmentVariable('Path',($$p+';$INSTDIR').TrimStart(';'),'User')}$\""
  SendMessage 0xFFFF 0x001A 0 "STR:Environment" /TIMEOUT=5000
!macroend

; Remove tsumugi install directory from user PATH on uninstall
!macro NSIS_HOOK_POSTUNINSTALL
  nsExec::ExecToLog "powershell.exe -NoProfile -Command $\"$$p=[Environment]::GetEnvironmentVariable('Path','User');if($$p){$$n=($$p -split ';'|Where-Object{$$_ -ne '$INSTDIR'})-join ';';[Environment]::SetEnvironmentVariable('Path',$$n,'User')}$\""
  SendMessage 0xFFFF 0x001A 0 "STR:Environment" /TIMEOUT=5000
!macroend
