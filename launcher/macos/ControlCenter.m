#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>

static NSColor *Gold(void) { return [NSColor colorWithCalibratedRed:0.82 green:0.70 blue:0.43 alpha:1]; }
static NSColor *Muted(void) { return [NSColor colorWithCalibratedRed:0.61 green:0.60 blue:0.54 alpha:1]; }
static NSColor *Panel(void) { return [NSColor colorWithCalibratedRed:0.10 green:0.105 blue:0.085 alpha:1]; }

@interface RealmForgeButton : NSButton
@property(nonatomic) BOOL primaryAppearance;
@property(nonatomic) BOOL hovering;
@property(nonatomic) BOOL pressing;
@property(nonatomic, strong) NSTrackingArea *buttonTrackingArea;
- (void)updateVisualStateAnimated:(BOOL)animated;
@end

@implementation RealmForgeButton

- (void)setPrimaryAppearance:(BOOL)primaryAppearance {
    _primaryAppearance = primaryAppearance;
    [self updateVisualStateAnimated:NO];
}

- (void)setEnabled:(BOOL)enabled {
    [super setEnabled:enabled];
    if (!enabled) { self.hovering = NO; self.pressing = NO; }
    [self updateTrackingAreas];
    [self updateVisualStateAnimated:NO];
    [self.window invalidateCursorRectsForView:self];
}

- (void)updateVisualStateAnimated:(BOOL)animated {
    if (!self.layer) return;
    BOOL disabled = !self.enabled;
    BOOL hovered = self.hovering && !disabled;
    BOOL pressed = self.pressing && !disabled;
    NSColor *background;
    NSColor *border;
    if (disabled) {
        background = self.primaryAppearance
            ? [NSColor colorWithCalibratedRed:0.48 green:0.42 blue:0.27 alpha:1]
            : [NSColor colorWithCalibratedRed:0.15 green:0.145 blue:0.12 alpha:1];
        border = [Gold() colorWithAlphaComponent:0.10];
    } else if (pressed) {
        background = self.primaryAppearance
            ? [NSColor colorWithCalibratedRed:0.68 green:0.56 blue:0.33 alpha:1]
            : [NSColor colorWithCalibratedRed:0.15 green:0.145 blue:0.12 alpha:1];
        border = [Gold() colorWithAlphaComponent:0.95];
    } else if (hovered) {
        background = self.primaryAppearance
            ? [NSColor colorWithCalibratedRed:0.91 green:0.79 blue:0.54 alpha:1]
            : [NSColor colorWithCalibratedRed:0.26 green:0.24 blue:0.19 alpha:1];
        border = [Gold() colorWithAlphaComponent:0.78];
    } else {
        background = self.primaryAppearance ? Gold() : [NSColor colorWithCalibratedRed:0.20 green:0.19 blue:0.15 alpha:1];
        border = [Gold() colorWithAlphaComponent:0.20];
    }
    CGColorRef nextBackground = background.CGColor;
    CGColorRef nextBorder = border.CGColor;
    if (animated) {
        CALayer *presentation = (CALayer *)self.layer.presentationLayer;
        CABasicAnimation *backgroundAnimation = [CABasicAnimation animationWithKeyPath:@"backgroundColor"];
        backgroundAnimation.fromValue = (__bridge id)(presentation.backgroundColor ?: self.layer.backgroundColor);
        backgroundAnimation.toValue = (__bridge id)nextBackground;
        backgroundAnimation.duration = 0.12;
        backgroundAnimation.timingFunction = [CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionEaseOut];
        [self.layer addAnimation:backgroundAnimation forKey:@"realmforge.button.background"];
        CABasicAnimation *borderAnimation = [CABasicAnimation animationWithKeyPath:@"borderColor"];
        borderAnimation.fromValue = (__bridge id)(presentation.borderColor ?: self.layer.borderColor);
        borderAnimation.toValue = (__bridge id)nextBorder;
        borderAnimation.duration = 0.12;
        borderAnimation.timingFunction = [CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionEaseOut];
        [self.layer addAnimation:borderAnimation forKey:@"realmforge.button.border"];
    }
    [CATransaction begin];
    [CATransaction setDisableActions:YES];
    self.layer.backgroundColor = nextBackground;
    self.layer.borderColor = nextBorder;
    self.layer.borderWidth = hovered || pressed ? 1.0 : 0.7;
    [CATransaction commit];
    self.alphaValue = disabled ? 0.52 : 1.0;
}

- (void)updateTrackingAreas {
    [super updateTrackingAreas];
    if (self.buttonTrackingArea) {
        [self removeTrackingArea:self.buttonTrackingArea];
        self.buttonTrackingArea = nil;
    }
    if (self.enabled) {
        NSTrackingAreaOptions options = NSTrackingMouseEnteredAndExited | NSTrackingActiveInKeyWindow | NSTrackingInVisibleRect;
        self.buttonTrackingArea = [[NSTrackingArea alloc] initWithRect:NSZeroRect options:options owner:self userInfo:nil];
        [self addTrackingArea:self.buttonTrackingArea];
    }
}

- (void)resetCursorRects {
    [super resetCursorRects];
    if (self.enabled) [self addCursorRect:self.bounds cursor:NSCursor.pointingHandCursor];
}

- (void)mouseEntered:(NSEvent *)event {
    [super mouseEntered:event];
    if (self.enabled) { self.hovering = YES; [self updateVisualStateAnimated:YES]; }
}

- (void)mouseExited:(NSEvent *)event {
    [super mouseExited:event];
    self.hovering = NO;
    self.pressing = NO;
    [self updateVisualStateAnimated:YES];
}

- (void)mouseDown:(NSEvent *)event {
    if (!self.enabled) { [super mouseDown:event]; return; }
    self.pressing = YES;
    [self updateVisualStateAnimated:NO];
    [super mouseDown:event];
    self.pressing = NO;
    [self updateVisualStateAnimated:YES];
}

@end

@interface ControlCenter : NSObject <NSWindowDelegate>
@property(nonatomic, strong) NSWindow *window;
@property(nonatomic, strong) NSTextField *statusLabel;
@property(nonatomic, strong) NSTextField *detailLabel;
@property(nonatomic, strong) NSTextField *errorLabel;
@property(nonatomic, strong) NSView *statusDot;
@property(nonatomic, strong) RealmForgeButton *startButton;
@property(nonatomic, strong) RealmForgeButton *stopButton;
@property(nonatomic, strong) RealmForgeButton *restartButton;
@property(nonatomic, strong) RealmForgeButton *adminButton;
@property(nonatomic, strong) RealmForgeButton *playerButton;
@property(nonatomic, strong) NSURL *launcherURL;
@property(nonatomic, copy) NSString *projectRoot;
@property(nonatomic, copy) NSString *action;
@property(nonatomic) BOOL ownsServer;
@property(nonatomic) BOOL canStart;
@property(nonatomic) BOOL polling;
@property(nonatomic, strong) NSTimer *pollTimer;
- (void)showWindow;
- (void)refreshStatus;
@end

@implementation ControlCenter

- (instancetype)init {
    self = [super init];
    if (!self) return nil;
    NSURL *resources = NSBundle.mainBundle.resourceURL;
    self.launcherURL = [resources URLByAppendingPathComponent:@"launcher/macos/realmforge.sh"];
    NSURL *rootURL = [resources URLByAppendingPathComponent:@"RealmForgeProjectRoot"];
    self.projectRoot = [[NSString stringWithContentsOfURL:rootURL encoding:NSUTF8StringEncoding error:nil] stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet] ?: @"";
    self.window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 620, 770)
        styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable
        backing:NSBackingStoreBuffered defer:NO];
    [self configureWindow];
    [self buildInterface];
    [self refreshStatus];
    self.pollTimer = [NSTimer scheduledTimerWithTimeInterval:2.0 target:self selector:@selector(refreshStatus) userInfo:nil repeats:YES];
    return self;
}

- (void)showWindow {
    [self.window center];
    [self.window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];
}

- (BOOL)windowShouldClose:(NSWindow *)sender {
    // Hiding the control center never stops the server.
    [self.window orderOut:nil];
    return NO;
}

- (void)configureWindow {
    self.window.title = @"RealmForge Control Center";
    self.window.minSize = NSMakeSize(560, 620);
    self.window.releasedWhenClosed = NO;
    self.window.delegate = self;
    self.window.backgroundColor = [NSColor colorWithCalibratedRed:0.065 green:0.07 blue:0.058 alpha:1];
    self.window.appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
    NSURL *iconURL = [NSBundle.mainBundle URLForResource:@"RealmForge" withExtension:@"icns"];
    if (iconURL) NSApp.applicationIconImage = [[NSImage alloc] initWithContentsOfURL:iconURL];
}

- (NSTextField *)label:(NSString *)text size:(CGFloat)size color:(NSColor *)color weight:(NSFontWeight)weight mono:(BOOL)mono {
    NSTextField *label = [NSTextField labelWithString:text];
    label.font = mono ? [NSFont monospacedSystemFontOfSize:size weight:weight] : [NSFont systemFontOfSize:size weight:weight];
    label.textColor = color;
    label.lineBreakMode = NSLineBreakByWordWrapping;
    return label;
}

- (NSStackView *)verticalStack:(NSArray<NSView *> *)views spacing:(CGFloat)spacing {
    NSStackView *stack = [self stackWithViews:views];
    stack.orientation = NSUserInterfaceLayoutOrientationVertical;
    stack.alignment = NSLayoutAttributeLeading;
    stack.spacing = spacing;
    return stack;
}

- (NSStackView *)stackWithViews:(NSArray<NSView *> *)views {
    NSStackView *stack = [[NSStackView alloc] init];
    for (NSView *view in views) [stack addArrangedSubview:view];
    return stack;
}

- (void)constrainToContent:(NSView *)view contentView:(NSView *)contentView {
    view.translatesAutoresizingMaskIntoConstraints = NO;
    [NSLayoutConstraint activateConstraints:@[[view.widthAnchor constraintEqualToAnchor:contentView.widthAnchor constant:-44]]];
}

- (NSView *)card:(NSString *)title subtitle:(NSString *)subtitle content:(void (^)(NSStackView *body))content {
    NSView *outer = [[NSView alloc] init];
    outer.wantsLayer = YES;
    outer.layer.backgroundColor = Panel().CGColor;
    outer.layer.borderColor = [NSColor colorWithCalibratedRed:0.30 green:0.27 blue:0.19 alpha:1].CGColor;
    outer.layer.borderWidth = 1;
    outer.layer.cornerRadius = 8;
    NSStackView *inner = [[NSStackView alloc] init];
    inner.orientation = NSUserInterfaceLayoutOrientationVertical;
    inner.alignment = NSLayoutAttributeLeading;
    inner.spacing = 10;
    inner.translatesAutoresizingMaskIntoConstraints = NO;
    [outer addSubview:inner];
    [NSLayoutConstraint activateConstraints:@[
        [inner.leadingAnchor constraintEqualToAnchor:outer.leadingAnchor constant:16],
        [inner.trailingAnchor constraintEqualToAnchor:outer.trailingAnchor constant:-16],
        [inner.topAnchor constraintEqualToAnchor:outer.topAnchor constant:14],
        [inner.bottomAnchor constraintEqualToAnchor:outer.bottomAnchor constant:-14],
    ]];
    NSTextField *heading = [self label:title size:10 color:Gold() weight:NSFontWeightBold mono:NO];
    NSTextField *description = [self label:subtitle size:11 color:Muted() weight:NSFontWeightRegular mono:NO];
    description.maximumNumberOfLines = 3;
    [inner addArrangedSubview:heading];
    [inner addArrangedSubview:description];
    content(inner);
    return outer;
}

- (NSView *)futureValue:(NSString *)title value:(NSString *)value {
    NSView *box = [[NSView alloc] init];
    box.wantsLayer = YES;
    box.layer.backgroundColor = [NSColor colorWithCalibratedRed:0.075 green:0.08 blue:0.067 alpha:1].CGColor;
    box.layer.cornerRadius = 5;
    NSTextField *heading = [self label:title size:8 color:Muted() weight:NSFontWeightBold mono:NO];
    NSTextField *text = [self label:value size:11 color:[NSColor colorWithCalibratedRed:0.77 green:0.72 blue:0.60 alpha:1] weight:NSFontWeightRegular mono:NO];
    NSStackView *group = [self verticalStack:@[heading, text] spacing:7];
    group.translatesAutoresizingMaskIntoConstraints = NO;
    [box addSubview:group];
    [NSLayoutConstraint activateConstraints:@[
        [group.leadingAnchor constraintEqualToAnchor:box.leadingAnchor constant:10],
        [group.trailingAnchor constraintEqualToAnchor:box.trailingAnchor constant:-8],
        [group.topAnchor constraintEqualToAnchor:box.topAnchor constant:10],
        [group.bottomAnchor constraintEqualToAnchor:box.bottomAnchor constant:-10],
    ]];
    return box;
}

- (void)styleButton:(RealmForgeButton *)button primary:(BOOL)primary {
    button.bordered = NO;
    button.wantsLayer = YES;
    button.layer.cornerRadius = 5;
    button.primaryAppearance = primary;
    button.contentTintColor = primary ? [NSColor colorWithCalibratedRed:0.12 green:0.11 blue:0.085 alpha:1] : [NSColor colorWithCalibratedRed:0.87 green:0.83 blue:0.74 alpha:1];
    button.font = [NSFont systemFontOfSize:11 weight:NSFontWeightSemibold];
    [button.heightAnchor constraintEqualToConstant:38].active = YES;
}

- (void)buildInterface {
    NSScrollView *scroll = [[NSScrollView alloc] init];
    scroll.drawsBackground = NO;
    scroll.hasVerticalScroller = YES;
    scroll.hasHorizontalScroller = NO;
    scroll.autohidesScrollers = YES;
    NSView *content = [[NSView alloc] init];
    content.translatesAutoresizingMaskIntoConstraints = NO;
    content.wantsLayer = YES;
    content.layer.backgroundColor = [NSColor colorWithCalibratedRed:0.065 green:0.07 blue:0.058 alpha:1].CGColor;
    NSStackView *stack = [[NSStackView alloc] init];
    stack.orientation = NSUserInterfaceLayoutOrientationVertical;
    stack.alignment = NSLayoutAttributeWidth;
    stack.spacing = 14;
    stack.translatesAutoresizingMaskIntoConstraints = NO;
    [content addSubview:stack];
    [NSLayoutConstraint activateConstraints:@[
        [stack.leadingAnchor constraintEqualToAnchor:content.leadingAnchor constant:22],
        [stack.trailingAnchor constraintEqualToAnchor:content.trailingAnchor constant:-22],
        [stack.topAnchor constraintEqualToAnchor:content.topAnchor constant:22],
        [stack.bottomAnchor constraintEqualToAnchor:content.bottomAnchor constant:-22],
    ]];
    scroll.documentView = content;
    self.window.contentView = scroll;
    [NSLayoutConstraint activateConstraints:@[
        [content.widthAnchor constraintEqualToAnchor:scroll.contentView.widthAnchor],
    ]];

    NSURL *iconURL = [NSBundle.mainBundle URLForResource:@"RealmForge" withExtension:@"icns"];
    NSImageView *icon = [[NSImageView alloc] init];
    if (iconURL) icon.image = [[NSImage alloc] initWithContentsOfURL:iconURL];
    icon.imageScaling = NSImageScaleProportionallyUpOrDown;
    icon.translatesAutoresizingMaskIntoConstraints = NO;
    [NSLayoutConstraint activateConstraints:@[[icon.widthAnchor constraintEqualToConstant:50], [icon.heightAnchor constraintEqualToConstant:50]]];
    NSTextField *name = [self label:@"RealmForge" size:23 color:[NSColor colorWithCalibratedRed:0.90 green:0.85 blue:0.72 alpha:1] weight:NSFontWeightSemibold mono:NO];
    name.font = [NSFont fontWithName:@"Cinzel-SemiBold" size:23] ?: [NSFont systemFontOfSize:23 weight:NSFontWeightSemibold];
    NSTextField *tag = [self label:@"LOCAL CAMPAIGN SERVER  ·  CONTROL CENTER" size:10 color:Muted() weight:NSFontWeightMedium mono:NO];
    NSStackView *brandText = [self verticalStack:@[name, tag] spacing:5];
    NSStackView *brand = [self stackWithViews:@[icon, brandText]];
    brand.orientation = NSUserInterfaceLayoutOrientationHorizontal;
    brand.alignment = NSLayoutAttributeCenterY;
    brand.spacing = 14;
    [stack addArrangedSubview:brand];
    [self constrainToContent:brand contentView:content];

    NSView *serverCard = [self card:@"SERVER STATUS" subtitle:@"A private service available only on this Mac." content:^(NSStackView *body) {
        NSStackView *row = [[NSStackView alloc] init];
        row.orientation = NSUserInterfaceLayoutOrientationHorizontal;
        row.alignment = NSLayoutAttributeCenterY;
        row.spacing = 9;
        self.statusDot = [[NSView alloc] init];
        self.statusDot.wantsLayer = YES;
        self.statusDot.layer.cornerRadius = 5;
        self.statusDot.translatesAutoresizingMaskIntoConstraints = NO;
        [NSLayoutConstraint activateConstraints:@[[self.statusDot.widthAnchor constraintEqualToConstant:10], [self.statusDot.heightAnchor constraintEqualToConstant:10]]];
        self.statusLabel = [self label:@"Checking" size:16 color:Gold() weight:NSFontWeightSemibold mono:NO];
        [row addArrangedSubview:self.statusDot]; [row addArrangedSubview:self.statusLabel];
        [body addArrangedSubview:row];
        [body addArrangedSubview:[self label:@"http://localhost:3001" size:13 color:[NSColor colorWithCalibratedRed:0.84 green:0.80 blue:0.70 alpha:1] weight:NSFontWeightRegular mono:YES]];
        self.detailLabel = [self label:@"Checking the local RealmForge server…" size:11 color:Muted() weight:NSFontWeightRegular mono:NO];
        self.detailLabel.maximumNumberOfLines = 3;
        [body addArrangedSubview:self.detailLabel];
        self.errorLabel = [self label:@"" size:11 color:[NSColor colorWithCalibratedRed:0.83 green:0.52 blue:0.46 alpha:1] weight:NSFontWeightRegular mono:NO];
        self.errorLabel.maximumNumberOfLines = 4; self.errorLabel.hidden = YES;
        [body addArrangedSubview:self.errorLabel];
    }];
    [stack addArrangedSubview:serverCard]; [self constrainToContent:serverCard contentView:content];

    NSView *controls = [self card:@"SERVER CONTROLS" subtitle:@"Startup builds the current client and server before launching." content:^(NSStackView *body) {
        self.startButton = [[RealmForgeButton alloc] initWithFrame:NSZeroRect];
        self.startButton.title = @"Start Server";
        self.startButton.target = self;
        self.startButton.action = @selector(startServer:);
        self.stopButton = [[RealmForgeButton alloc] initWithFrame:NSZeroRect];
        self.stopButton.title = @"Stop Server";
        self.stopButton.target = self;
        self.stopButton.action = @selector(stopServer:);
        self.restartButton = [[RealmForgeButton alloc] initWithFrame:NSZeroRect];
        self.restartButton.title = @"Restart Server";
        self.restartButton.target = self;
        self.restartButton.action = @selector(restartServer:);
        [self styleButton:self.startButton primary:YES]; [self styleButton:self.stopButton primary:NO]; [self styleButton:self.restartButton primary:NO];
        NSStackView *row = [self stackWithViews:@[self.startButton, self.stopButton, self.restartButton]];
        row.orientation = NSUserInterfaceLayoutOrientationHorizontal; row.distribution = NSStackViewDistributionFillEqually; row.spacing = 9;
        [body addArrangedSubview:row];
    }];
    [stack addArrangedSubview:controls]; [self constrainToContent:controls contentView:content];

    NSView *interfaces = [self card:@"BROWSER INTERFACES" subtitle:@"Role-specific entry points are not available yet; both buttons open the existing RealmForge interface." content:^(NSStackView *body) {
        self.adminButton = [[RealmForgeButton alloc] initWithFrame:NSZeroRect];
        self.adminButton.title = @"Open Admin / DM";
        self.adminButton.target = self;
        self.adminButton.action = @selector(openAdmin:);
        self.playerButton = [[RealmForgeButton alloc] initWithFrame:NSZeroRect];
        self.playerButton.title = @"Open My Player";
        self.playerButton.target = self;
        self.playerButton.action = @selector(openPlayer:);
        [self styleButton:self.adminButton primary:YES]; [self styleButton:self.playerButton primary:NO];
        NSStackView *row = [self stackWithViews:@[self.adminButton, self.playerButton]];
        row.orientation = NSUserInterfaceLayoutOrientationHorizontal; row.distribution = NSStackViewDistributionFillEqually; row.spacing = 9;
        [body addArrangedSubview:row];
    }];
    [stack addArrangedSubview:interfaces]; [self constrainToContent:interfaces contentView:content];

    NSView *future = [self card:@"PLAYER CONNECTIONS" subtitle:@"Local-network and remote access are not enabled. RealmForge is not exposed beyond this Mac." content:^(NSStackView *body) {
        NSStackView *row = [self stackWithViews:@[
            [self futureValue:@"LOCAL-NETWORK PLAYERS" value:@"Coming later"],
            [self futureValue:@"REMOTE PLAYERS" value:@"Coming later"],
            [self futureValue:@"CONNECTED PLAYERS" value:@"Unavailable"],
        ]];
        row.orientation = NSUserInterfaceLayoutOrientationHorizontal; row.distribution = NSStackViewDistributionFillEqually; row.spacing = 9;
        [body addArrangedSubview:row];
    }];
    [stack addArrangedSubview:future]; [self constrainToContent:future contentView:content];
    NSTextField *note = [self label:@"Closing this window hides the Control Center. The server continues running until you choose Stop Server." size:10 color:Muted() weight:NSFontWeightRegular mono:NO];
    note.maximumNumberOfLines = 3;
    [stack addArrangedSubview:note]; [self constrainToContent:note contentView:content];
    [self setStatus:@"Checking" detail:@"Checking the local RealmForge server…"];
}

- (void)setStatus:(NSString *)status detail:(NSString *)detail {
    self.statusLabel.stringValue = status;
    self.detailLabel.stringValue = detail;
    NSColor *color = [status isEqualToString:@"Online"] ? [NSColor colorWithCalibratedRed:0.42 green:0.67 blue:0.48 alpha:1] : ([status isEqualToString:@"Error"] ? [NSColor colorWithCalibratedRed:0.75 green:0.34 blue:0.29 alpha:1] : Gold());
    self.statusLabel.textColor = color;
    self.statusDot.layer.backgroundColor = color.CGColor;
    BOOL busy = self.action != nil;
    self.startButton.enabled = !busy && self.canStart;
    self.stopButton.enabled = !busy && self.ownsServer;
    self.restartButton.enabled = !busy && self.ownsServer;
    self.adminButton.enabled = !busy && [status isEqualToString:@"Online"];
    self.playerButton.enabled = !busy && [status isEqualToString:@"Online"];
}

- (void)showError:(NSString *)message {
    self.errorLabel.stringValue = message;
    self.errorLabel.hidden = NO;
    self.statusLabel.stringValue = @"Error";
    self.statusLabel.textColor = [NSColor colorWithCalibratedRed:0.85 green:0.55 blue:0.48 alpha:1];
    self.statusDot.layer.backgroundColor = [NSColor colorWithCalibratedRed:0.75 green:0.34 blue:0.29 alpha:1].CGColor;
}

- (void)runLauncher:(NSString *)command completion:(void (^)(BOOL success, NSString *output))completion {
    if (!self.projectRoot.length || ![NSFileManager.defaultManager isExecutableFileAtPath:self.launcherURL.path]) {
        completion(NO, @"The embedded RealmForge launcher or project path is missing. Rebuild the app from ~/RealmForge.");
        return;
    }
    NSTask *task = [[NSTask alloc] init];
    task.executableURL = [NSURL fileURLWithPath:@"/bin/zsh"];
    task.arguments = @[self.launcherURL.path, command];
    NSMutableDictionary *environment = [NSProcessInfo.processInfo.environment mutableCopy];
    environment[@"REALMFORGE_NO_OPEN"] = @"1";
    environment[@"OLLAMA_WORLD_TIMEOUT_MS"] = @"300000";
    task.environment = environment;
    NSPipe *output = [[NSPipe alloc] init];
    NSPipe *errors = [[NSPipe alloc] init];
    task.standardOutput = output; task.standardError = errors;
    task.terminationHandler = ^(NSTask *finished) {
        NSData *stdoutData = output.fileHandleForReading.readDataToEndOfFile;
        NSData *stderrData = errors.fileHandleForReading.readDataToEndOfFile;
        NSString *stdoutText = [[NSString alloc] initWithData:stdoutData encoding:NSUTF8StringEncoding] ?: @"";
        NSString *stderrText = [[NSString alloc] initWithData:stderrData encoding:NSUTF8StringEncoding] ?: @"";
        dispatch_async(dispatch_get_main_queue(), ^{
            BOOL success = finished.terminationStatus == 0;
            NSString *text = success ? stdoutText : (stderrText.length ? stderrText : stdoutText);
            completion(success, [text stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet]);
        });
    };
    NSError *error = nil;
    if (![task launchAndReturnError:&error]) completion(NO, error.localizedDescription ?: @"Could not run the launcher.");
}

- (void)refreshStatus {
    if (self.action.length || self.polling) return;
    self.polling = YES;
    [self runLauncher:@"control-status" completion:^(BOOL success, NSString *output) {
        self.polling = NO;
        if (!success) {
            self.ownsServer = NO; self.canStart = NO;
            [self setStatus:@"Error" detail:@"Could not check launcher status."];
            self.errorLabel.hidden = NO; self.errorLabel.stringValue = output;
            return;
        }
        NSData *data = [output dataUsingEncoding:NSUTF8StringEncoding];
        NSDictionary *payload = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
        if (![payload isKindOfClass:NSDictionary.class]) {
            self.ownsServer = NO; self.canStart = NO;
            [self setStatus:@"Error" detail:@"Could not read launcher status."];
            self.errorLabel.hidden = NO; self.errorLabel.stringValue = @"The launcher returned an unreadable status response.";
            return;
        }
        self.ownsServer = [payload[@"owned"] boolValue];
        self.canStart = [payload[@"canStart"] boolValue];
        self.errorLabel.hidden = YES;
        NSString *rawStatus = payload[@"status"] ?: @"error";
        NSString *status = [rawStatus.capitalizedString copy];
        [self setStatus:status detail:payload[@"message"] ?: @"Status unavailable."];
        if ([status isEqualToString:@"Error"]) { self.errorLabel.stringValue = payload[@"message"] ?: @"The server could not be verified."; self.errorLabel.hidden = NO; }
    }];
}

- (void)performAction:(NSString *)command visibleStatus:(NSString *)status detail:(NSString *)detail {
    if (self.action.length) return;
    self.action = command;
    [self setStatus:status detail:detail];
    [self runLauncher:command completion:^(BOOL success, NSString *output) {
        self.action = nil;
        if (!success) { self.errorLabel.hidden = NO; self.errorLabel.stringValue = output; }
        [self refreshStatus];
    }];
}

- (void)startServer:(id)sender {
    if (self.canStart && !self.ownsServer) [self performAction:@"start" visibleStatus:@"Starting" detail:@"Building and starting the local server…"];
}

- (void)stopServer:(id)sender {
    if (self.ownsServer) [self performAction:@"stop" visibleStatus:@"Stopping" detail:@"Stopping the RealmForge server safely…"];
}

- (void)restartServer:(id)sender {
    if (!self.ownsServer || self.action.length) return;
    self.action = @"restart";
    [self setStatus:@"Stopping" detail:@"Restarting RealmForge safely…"];
    [self runLauncher:@"stop" completion:^(BOOL stopped, NSString *stopOutput) {
        if (!stopped) {
            self.action = nil; self.errorLabel.hidden = NO; self.errorLabel.stringValue = stopOutput; [self refreshStatus]; return;
        }
        [self setStatus:@"Starting" detail:@"Restarting RealmForge safely…"];
        [self runLauncher:@"start" completion:^(BOOL started, NSString *startOutput) {
            self.action = nil;
            if (!started) { self.errorLabel.hidden = NO; self.errorLabel.stringValue = startOutput; }
            [self refreshStatus];
        }];
    }];
}

- (void)openAdmin:(id)sender {
    [NSWorkspace.sharedWorkspace openURL:[NSURL URLWithString:@"http://localhost:3001/dm"]];
}

- (void)openPlayer:(id)sender {
    [NSWorkspace.sharedWorkspace openURL:[NSURL URLWithString:@"http://localhost:3001/player"]];
}

@end

@interface AppDelegate : NSObject <NSApplicationDelegate>
@property(nonatomic, strong) ControlCenter *controlCenter;
@end

@implementation AppDelegate
- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    NSApp.appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
    self.controlCenter = [[ControlCenter alloc] init];
    NSMenu *main = [[NSMenu alloc] init];
    NSMenuItem *root = [[NSMenuItem alloc] init];
    [main addItem:root];
    NSMenu *application = [[NSMenu alloc] init];
    [application addItemWithTitle:@"Quit RealmForge Control Center" action:@selector(terminate:) keyEquivalent:@"q"].target = NSApp;
    root.submenu = application;
    NSApp.mainMenu = main;
    [self.controlCenter showWindow];
}
- (BOOL)applicationShouldHandleReopen:(NSApplication *)sender hasVisibleWindows:(BOOL)flag {
    [self.controlCenter showWindow];
    return YES;
}
@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSApplication *application = [NSApplication sharedApplication];
        AppDelegate *delegate = [[AppDelegate alloc] init];
        application.delegate = delegate;
        [application setActivationPolicy:NSApplicationActivationPolicyRegular];
        [application run];
    }
    return 0;
}
