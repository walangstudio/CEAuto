@echo off
setlocal enabledelayedexpansion

rem ── Config ──────────────────────────────────────────────
set "MARKER_FILE=.ceauto-installed"
set "CEAUTO_DIR=%~dp0"
if "!CEAUTO_DIR:~-1!"=="\" set "CEAUTO_DIR=!CEAUTO_DIR:~0,-1!"

rem ── Defaults ────────────────────────────────────────────
set "FORCE=false"
set "UNINSTALL=false"
set "UPDATE=false"
set "CLIENT=desktop"
set "SKIP_TEST=false"
set "GLOBAL_CONFIG=false"
set "CLIENT_EXPLICIT=false"

goto :parse_args

rem ════════════════════════════════════════════════════════
:show_help
echo Usage: install.bat [options]
echo.
echo Options:
echo   -c, --client TYPE   MCP client: desktop, code, kilo, opencode, goose, all (default: desktop)
echo   -f, --force         Skip prompts, overwrite existing config
echo   -u, --uninstall     Remove CEAuto from MCP client config
echo       --upgrade       Upgrade npm deps and reconfigure
echo       --update        Alias for --upgrade
echo       --global        Write to global config path (applies to: code, opencode, all)
echo                       Default (no --global): writes to parent workspace dir
echo       --skip-test     Skip server validation
echo   -h, --help          Show this help
echo.
echo Examples:
echo   install.bat                      Install for Claude Desktop
echo   install.bat -c code              Install for Claude Code (workspace-local)
echo   install.bat -c code --global     Install for Claude Code (global config)
echo   install.bat -c kilo              Install for Kilo Code
echo   install.bat -c opencode          Install for OpenCode (workspace-local)
echo   install.bat -c opencode --global Install for OpenCode (global)
echo   install.bat -c goose             Install for Goose
echo   install.bat -c all               Install for all detected clients
echo   install.bat --upgrade            Upgrade npm deps
echo   install.bat --upgrade -c code    Upgrade + reconfigure Claude Code
echo   install.bat -u                   Uninstall
echo   install.bat -u -c all            Uninstall from all client configs
echo   install.bat -f --skip-test       Force install, skip tests
exit /b 0

rem ════════════════════════════════════════════════════════
:parse_args
if "%~1"=="" goto :args_done
if /i "%~1"=="-h"          goto :show_help
if /i "%~1"=="--help"      goto :show_help
if /i "%~1"=="-f"          goto :pf_force
if /i "%~1"=="--force"     goto :pf_force
if /i "%~1"=="-u"          goto :pf_uninstall
if /i "%~1"=="--uninstall" goto :pf_uninstall
if /i "%~1"=="--update"    goto :pf_update
if /i "%~1"=="--upgrade"   goto :pf_update
if /i "%~1"=="--global"    goto :pf_global
if /i "%~1"=="--skip-test" goto :pf_skip_test
if /i "%~1"=="-c"          goto :pf_client
if /i "%~1"=="--client"    goto :pf_client
echo Unknown option: %~1
goto :show_help

:pf_force
set "FORCE=true"
shift
goto :parse_args
:pf_uninstall
set "UNINSTALL=true"
shift
goto :parse_args
:pf_update
set "UPDATE=true"
shift
goto :parse_args
:pf_global
set "GLOBAL_CONFIG=true"
shift
goto :parse_args
:pf_skip_test
set "SKIP_TEST=true"
shift
goto :parse_args
:pf_client
if "%~2"=="" (
    echo   ERROR: --client requires a value >&2
    exit /b 1
)
set "CLIENT=%~2"
set "CLIENT_EXPLICIT=true"
shift
shift
goto :parse_args

:args_done

rem ── Validate --global ─────────────────────────────────
if "!GLOBAL_CONFIG!"=="true" (
    if not "!CLIENT!"=="code" (
        if not "!CLIENT!"=="both" (
            if not "!CLIENT!"=="opencode" (
                if not "!CLIENT!"=="all" (
                    echo   ERROR: --global is only valid with -c code, opencode, both, or all >&2
                    exit /b 1
                )
            )
        )
    )
)

rem ── Read version from package.json ───────────────────────
set "VERSION=unknown"
for /f "usebackq delims=" %%V in (`node -e "console.log(require('!CEAUTO_DIR!\package.json').version)" 2^>nul`) do set "VERSION=%%V"

rem ── Read installed version ───────────────────────────────
set "INSTALLED_VERSION="
if exist "!CEAUTO_DIR!\!MARKER_FILE!" (
    set /p INSTALLED_VERSION=<"!CEAUTO_DIR!\!MARKER_FILE!"
)

rem ── Compute config paths ─────────────────────────────────
set "DESKTOP_CONFIG=!APPDATA!\Claude\claude_desktop_config.json"

if "!GLOBAL_CONFIG!"=="true" (
    set "CODE_CONFIG=!USERPROFILE!\.claude\mcp.json"
) else (
    for %%I in ("!CEAUTO_DIR!") do set "_PARENT=%%~dpI"
    if "!_PARENT:~-1!"=="\" set "_PARENT=!_PARENT:~0,-1!"
    set "CODE_CONFIG=!_PARENT!\.mcp.json"
)

for %%I in ("!CEAUTO_DIR!") do set "_PARENT=%%~dpI"
if "!_PARENT:~-1!"=="\" set "_PARENT=!_PARENT:~0,-1!"
set "KILO_CONFIG=!_PARENT!\.kilocode\mcp.json"

if "!GLOBAL_CONFIG!"=="true" (
    set "OPENCODE_CONFIG=!USERPROFILE!\.config\opencode\opencode.json"
) else (
    set "OPENCODE_CONFIG=!_PARENT!\opencode.json"
)

set "GOOSE_CONFIG=!USERPROFILE!\.config\goose\config.yaml"
set "SERVER_JS=!CEAUTO_DIR!\server.js"

rem ── Write Node.js helper scripts to temp ─────────────────
set "PY_MERGE=!TEMP!\ceauto_merge.js"
set "PY_REMOVE=!TEMP!\ceauto_remove.js"
set "PY_CHECK=!TEMP!\ceauto_check.js"
set "PY_MERGE_OPENCODE=!TEMP!\ceauto_merge_opencode.js"
set "PY_REMOVE_OPENCODE=!TEMP!\ceauto_remove_opencode.js"
set "PY_MERGE_GOOSE=!TEMP!\ceauto_merge_goose.js"
set "PY_REMOVE_GOOSE=!TEMP!\ceauto_remove_goose.js"

rem -- MERGE standard --
(
echo const fs = require('fs'), path = require('path');
echo const [,, cfgPath, srvPath] = process.argv;
echo let c = {}; try { c = JSON.parse(fs.readFileSync(cfgPath,'utf8')); } catch {}
echo c.mcpServers = c.mcpServers ^|^| {};
echo c.mcpServers.ceauto = { command: 'node', args: [srvPath] };
echo fs.mkdirSync(path.dirname(path.resolve(cfgPath)),{recursive:true});
echo fs.writeFileSync(cfgPath, JSON.stringify(c,null,2)+'\n');
) > "!PY_MERGE!"

rem -- REMOVE standard --
(
echo const fs = require('fs');
echo const cfgPath = process.argv[2];
echo if (!fs.existsSync(cfgPath)) process.exit(0);
echo let c = {}; try { c = JSON.parse(fs.readFileSync(cfgPath,'utf8')); } catch { process.exit(0); }
echo const s = c.mcpServers ^|^| {};
echo if ('ceauto' in s) { delete s.ceauto; fs.writeFileSync(cfgPath,JSON.stringify(c,null,2)+'\n'); console.log('  Removed ceauto from config'); }
echo else { console.log('  ceauto not found in config'); }
) > "!PY_REMOVE!"

rem -- CHECK --
(
echo const fs = require('fs');
echo const [,,cfgPath,srvPath] = process.argv;
echo try {
echo   const c = JSON.parse(fs.readFileSync(cfgPath,'utf8'));
echo   const e = (c.mcpServers^|^|{}).ceauto^|^|{};
echo   const args = e.args^|^|[];
echo   if (args.includes(srvPath)) console.log('uptodate');
echo   else if (args.length) console.log('changed');
echo   else console.log('missing');
echo } catch { console.log('missing'); }
) > "!PY_CHECK!"

rem -- MERGE opencode --
(
echo const fs = require('fs'), path = require('path');
echo const [,,cfgPath,srvPath] = process.argv;
echo let c = {}; try { c = JSON.parse(fs.readFileSync(cfgPath,'utf8')); } catch {}
echo c.mcp = c.mcp ^|^| {};
echo c.mcp.ceauto = { type: 'local', command: ['node', srvPath] };
echo fs.mkdirSync(path.dirname(path.resolve(cfgPath)),{recursive:true});
echo fs.writeFileSync(cfgPath, JSON.stringify(c,null,2)+'\n');
) > "!PY_MERGE_OPENCODE!"

rem -- REMOVE opencode --
(
echo const fs = require('fs');
echo const cfgPath = process.argv[2];
echo if (!fs.existsSync(cfgPath)) process.exit(0);
echo let c = {}; try { c = JSON.parse(fs.readFileSync(cfgPath,'utf8')); } catch { process.exit(0); }
echo const m = c.mcp^|^|{};
echo if ('ceauto' in m) { delete m.ceauto; fs.writeFileSync(cfgPath,JSON.stringify(c,null,2)+'\n'); console.log('  Removed ceauto from config'); }
echo else { console.log('  ceauto not found in config'); }
) > "!PY_REMOVE_OPENCODE!"

rem -- MERGE goose --
(
echo const fs = require('fs'), path = require('path');
echo const [,,cfgPath,srvPath] = process.argv;
echo let yaml; try { yaml = require('!CEAUTO_DIR!\node_modules\js-yaml'); } catch {
echo   console.log('  js-yaml unavailable. Add manually to Goose config.');
echo   process.exit(0);
echo }
echo let c = {}; try { c = yaml.load(fs.readFileSync(cfgPath,'utf8'))^|^|{}; } catch {}
echo c.extensions = c.extensions^|^|{};
echo c.extensions.ceauto = {name:'ceauto',type:'stdio',cmd:'node',args:[srvPath],enabled:true};
echo fs.mkdirSync(path.dirname(path.resolve(cfgPath)),{recursive:true});
echo fs.writeFileSync(cfgPath, yaml.dump(c,{lineWidth:-1}));
) > "!PY_MERGE_GOOSE!"

rem -- REMOVE goose --
(
echo const fs = require('fs');
echo const cfgPath = process.argv[2];
echo let yaml; try { yaml = require('!CEAUTO_DIR!\node_modules\js-yaml'); } catch { console.log('  js-yaml unavailable'); process.exit(0); }
echo if (!fs.existsSync(cfgPath)) process.exit(0);
echo let c = {}; try { c = yaml.load(fs.readFileSync(cfgPath,'utf8'))^|^|{}; } catch { process.exit(0); }
echo const e = c.extensions^|^|{};
echo if ('ceauto' in e) { delete e.ceauto; fs.writeFileSync(cfgPath,yaml.dump(c,{lineWidth:-1})); console.log('  Removed ceauto from config'); }
echo else { console.log('  ceauto not found in config'); }
) > "!PY_REMOVE_GOOSE!"

rem ── Banner ───────────────────────────────────────────────
echo.
echo   CEAuto v!VERSION!
if "!UPDATE!"=="true" (
    if not "!INSTALLED_VERSION!"=="" (
        if not "!INSTALLED_VERSION!"=="!VERSION!" (
            echo   Upgrading from v!INSTALLED_VERSION!
        )
    )
)
if "!UNINSTALL!"=="true" (
    echo   Mode: uninstall
) else if "!UPDATE!"=="true" (
    echo   Mode: update
) else (
    echo   Mode: install ^(client: !CLIENT!^)
)
echo   -----------------------------
echo.

rem ── Uninstall ────────────────────────────────────────────
if not "!UNINSTALL!"=="true" goto :not_uninstall

call :configure_client "!CLIENT!" ""

del /f /q "!CEAUTO_DIR!\!MARKER_FILE!" 2>nul
echo   Removed version marker
echo.
echo   CEAuto uninstalled.
echo.
goto :cleanup

:not_uninstall

rem ── Update/Upgrade ────────────────────────────────────────
if not "!UPDATE!"=="true" goto :not_update

if not "!INSTALLED_VERSION!"=="" (
    if "!INSTALLED_VERSION!"=="!VERSION!" (
        if not "!CLIENT_EXPLICIT!"=="true" (
            if not "!FORCE!"=="true" (
                echo   Already at v!VERSION!. Nothing to do.
                echo   Use --upgrade -c code^|all to also reconfigure MCP client.
                echo.
                goto :cleanup
            )
        )
        echo   Already at v!VERSION! -- reconfiguring MCP client
    ) else (
        echo   Upgrading v!INSTALLED_VERSION! --^> v!VERSION!
    )
) else (
    echo   No marker found -- running full update
)
echo.

echo   Upgrading npm dependencies...
pushd "!CEAUTO_DIR!" && npm install --silent && popd
echo   OK: Dependencies upgraded
echo.

if "!CLIENT_EXPLICIT!"=="true" (
    echo   Reconfiguring MCP client ^(!CLIENT!^)...
    call :configure_client "!CLIENT!" "!SERVER_JS!"
    echo.
)

if not "!SKIP_TEST!"=="true" (
    echo   Validating server...
    node --check "!SERVER_JS!" >nul 2>&1
    if !errorlevel! equ 0 (
        echo   OK: Server validation passed
    ) else (
        echo   ERROR: Validation failed. Run 'node --check server.js' for details. >&2
    )
    echo.
)

echo !VERSION!> "!CEAUTO_DIR!\!MARKER_FILE!"
echo   OK: Marker updated to v!VERSION!
echo   -----------------------------
echo   CEAuto updated to v!VERSION!!
echo.
echo   Restart Claude (quit fully, then reopen) to load changes.
echo.
goto :cleanup

:not_update

rem ── Install ───────────────────────────────────────────────

if not "!INSTALLED_VERSION!"=="" (
    if "!INSTALLED_VERSION!"=="!VERSION!" (
        if not "!FORCE!"=="true" (
            echo   Already at v!VERSION!. Nothing to do.
            echo   Use --upgrade to upgrade dependencies, or -f to force reinstall.
            echo.
            goto :cleanup
        )
    )
)

rem 1. Check Node.js
echo   Checking Node.js...
node --version >nul 2>&1
if !errorlevel! neq 0 (
    echo   ERROR: Node.js is required. Install from https://nodejs.org >&2
    exit /b 1
)
for /f "usebackq delims=" %%V in (`node -e "console.log(process.version)" 2^>nul`) do set "NODE_VER=%%V"
for /f "usebackq delims=." %%M in (`node -e "console.log(process.versions.node.split('.')[0])" 2^>nul`) do set "NODE_MAJOR=%%M"
if !NODE_MAJOR! lss 18 (
    echo   ERROR: Node.js 18+ is required. Current: !NODE_VER! >&2
    exit /b 1
)
echo   OK: Node.js !NODE_VER!
echo.

rem 2. Install deps
echo   Installing dependencies...
pushd "!CEAUTO_DIR!" && npm install --silent && popd
echo   OK: Dependencies installed
echo.

rem 3. Validate server
if not "!SKIP_TEST!"=="true" (
    echo   Validating server...
    node --check "!SERVER_JS!" >nul 2>&1
    if !errorlevel! equ 0 (
        echo   OK: Server validation passed
    ) else (
        echo   ERROR: Validation failed. Run 'node --check server.js' for details. >&2
        echo   ERROR: Use --skip-test to skip this step. >&2
        goto :cleanup
    )
    echo.
)

rem 4. Configure MCP client
echo   Configuring MCP client...
call :configure_client "!CLIENT!" "!SERVER_JS!"
echo.

rem 5. Write marker
echo !VERSION!> "!CEAUTO_DIR!\!MARKER_FILE!"

rem ── Done ─────────────────────────────────────────────────
echo   -----------------------------
echo   CEAuto installed successfully!
echo.
echo   Next steps:
if "!CLIENT!"=="code" (
    echo   1. Open the workspace in Claude Code
    echo   2. Fill in memory\context.md and strategy\goals.md
    echo   3. Call ceo_boot to start
) else if "!CLIENT!"=="kilo" (
    echo   1. Open the workspace in Kilo Code
    echo   2. Fill in memory\context.md and strategy\goals.md
    echo   3. Call ceo_boot to start
) else if "!CLIENT!"=="opencode" (
    echo   1. Restart OpenCode to load the new MCP server
    echo   2. Fill in memory\context.md and strategy\goals.md
    echo   3. Call ceo_boot to start
) else if "!CLIENT!"=="goose" (
    echo   1. Restart Goose to load the new MCP server
    echo   2. Fill in memory\context.md and strategy\goals.md
    echo   3. Call ceo_boot to start
) else (
    echo   1. Restart Claude Desktop (quit fully, then reopen)
    echo   2. Fill in memory\context.md and strategy\goals.md
    echo   3. Call ceo_boot to start
)
echo.

:cleanup
del /f /q "!PY_MERGE!" "!PY_REMOVE!" "!PY_CHECK!" 2>nul
del /f /q "!PY_MERGE_OPENCODE!" "!PY_REMOVE_OPENCODE!" 2>nul
del /f /q "!PY_MERGE_GOOSE!" "!PY_REMOVE_GOOSE!" 2>nul
endlocal
exit /b 0

rem ════════════════════════════════════════════════════════
rem Subroutine: configure_client <client_type> <server_js>
:configure_client
set "_ct=%~1"
set "_sj=%~2"

if "!_ct!"=="desktop"  goto :cc_desktop
if "!_ct!"=="code"     goto :cc_code
if "!_ct!"=="kilo"     goto :cc_kilo
if "!_ct!"=="opencode" goto :cc_opencode
if "!_ct!"=="goose"    goto :cc_goose
if "!_ct!"=="both"     goto :cc_both
if "!_ct!"=="all"      goto :cc_all
echo   ERROR: Unknown client type: !_ct! >&2
goto :eof

:cc_desktop
echo   Client: Claude Desktop
echo   Config: !DESKTOP_CONFIG!
call :_configure_one_path "!DESKTOP_CONFIG!" "!_sj!"
goto :eof

:cc_code
if "!GLOBAL_CONFIG!"=="true" (
    echo   Client: Claude Code ^(global^)
    if exist "!USERPROFILE!\.claude.json" (
        echo   Config: !USERPROFILE!\.claude.json
        call :_configure_one_path "!USERPROFILE!\.claude.json" "!_sj!"
    )
    if exist "!USERPROFILE!\.claude\mcp.json" (
        echo   Config: !USERPROFILE!\.claude\mcp.json
        call :_configure_one_path "!USERPROFILE!\.claude\mcp.json" "!_sj!"
    )
    if not exist "!USERPROFILE!\.claude.json" (
        if not exist "!USERPROFILE!\.claude\mcp.json" (
            echo   Config: !USERPROFILE!\.claude.json
            call :_configure_one_path "!USERPROFILE!\.claude.json" "!_sj!"
        )
    )
) else (
    echo   Client: Claude Code ^(workspace^)
    echo   Config: !CODE_CONFIG!
    call :_configure_one_path "!CODE_CONFIG!" "!_sj!"
)
goto :eof

:cc_kilo
echo   Client: Kilo Code
echo   Config: !KILO_CONFIG!
call :_configure_one_path "!KILO_CONFIG!" "!_sj!"
goto :eof

:cc_opencode
echo   Client: OpenCode
echo   Config: !OPENCODE_CONFIG!
if "!UNINSTALL!"=="true" (
    if exist "!OPENCODE_CONFIG!" (
        for /f "tokens=*" %%T in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMddHHmmss"') do set "_ts=%%T"
        copy /y "!OPENCODE_CONFIG!" "!OPENCODE_CONFIG!.backup.!_ts!" >nul
        node "!PY_REMOVE_OPENCODE!" "!OPENCODE_CONFIG!"
    ) else ( echo   Config not found, nothing to remove )
) else (
    if exist "!OPENCODE_CONFIG!" (
        for /f "tokens=*" %%T in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMddHHmmss"') do set "_ts=%%T"
        copy /y "!OPENCODE_CONFIG!" "!OPENCODE_CONFIG!.backup.!_ts!" >nul
        echo   Backed up existing config
    )
    node "!PY_MERGE_OPENCODE!" "!OPENCODE_CONFIG!" "!_sj!"
    echo   OK: MCP config updated
)
goto :eof

:cc_goose
echo   Client: Goose
echo   Config: !GOOSE_CONFIG!
if "!UNINSTALL!"=="true" (
    if exist "!GOOSE_CONFIG!" (
        for /f "tokens=*" %%T in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMddHHmmss"') do set "_ts=%%T"
        copy /y "!GOOSE_CONFIG!" "!GOOSE_CONFIG!.backup.!_ts!" >nul
        node "!PY_REMOVE_GOOSE!" "!GOOSE_CONFIG!"
    ) else ( echo   Config not found, nothing to remove )
) else (
    if exist "!GOOSE_CONFIG!" (
        for /f "tokens=*" %%T in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMddHHmmss"') do set "_ts=%%T"
        copy /y "!GOOSE_CONFIG!" "!GOOSE_CONFIG!.backup.!_ts!" >nul
        echo   Backed up existing config
    )
    node "!PY_MERGE_GOOSE!" "!GOOSE_CONFIG!" "!_sj!"
    echo   OK: MCP config updated
)
goto :eof

:cc_both
call :configure_client "desktop" "!_sj!"
echo.
call :configure_client "code" "!_sj!"
goto :eof

:cc_all
call :configure_client "desktop" "!_sj!"
echo.
call :configure_client "code" "!_sj!"
if "!UNINSTALL!"=="true" (
    echo. & call :configure_client "kilo" "!_sj!"
    echo. & call :configure_client "opencode" "!_sj!"
    echo. & call :configure_client "goose" "!_sj!"
) else (
    if exist "!KILO_CONFIG!" ( echo. & call :configure_client "kilo" "!_sj!" )
    if exist "!OPENCODE_CONFIG!" ( echo. & call :configure_client "opencode" "!_sj!" )
    if exist "!GOOSE_CONFIG!" ( echo. & call :configure_client "goose" "!_sj!" )
)
goto :eof

rem ════════════════════════════════════════════════════════
rem Subroutine: _configure_one_path <config_path> <server_js>
:_configure_one_path
set "_cfg=%~1"
set "_sj2=%~2"

if "!UNINSTALL!"=="true" (
    if exist "!_cfg!" (
        for /f "tokens=*" %%T in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMddHHmmss"') do set "_ts=%%T"
        copy /y "!_cfg!" "!_cfg!.backup.!_ts!" >nul
        node "!PY_REMOVE!" "!_cfg!"
    ) else ( echo   Config not found, nothing to remove )
    goto :eof
)

if exist "!_cfg!" (
    if not "!FORCE!"=="true" (
        for /f "usebackq delims=" %%R in (`node "!PY_CHECK!" "!_cfg!" "!_sj2!" 2^>nul`) do set "_chk=%%R"
        if "!_chk!"=="uptodate" ( echo   MCP config already up to date & goto :eof )
        if "!_chk!"=="changed"  ( echo   Updating MCP config ^(server path changed^) )
    )
)

if exist "!_cfg!" (
    for /f "tokens=*" %%T in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMddHHmmss"') do set "_ts=%%T"
    copy /y "!_cfg!" "!_cfg!.backup.!_ts!" >nul
    echo   Backed up existing config
)

node "!PY_MERGE!" "!_cfg!" "!_sj2!"
echo   OK: MCP config updated
goto :eof
