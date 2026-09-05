#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <math.h>
#include <dlfcn.h>
#include <objc/runtime.h>
#include <objc/message.h>
#include <CoreGraphics/CoreGraphics.h>
#include <ImageIO/ImageIO.h>
#include <CoreFoundation/CoreFoundation.h>

#define HARPY_CAPTURE_OK 0
#define HARPY_CAPTURE_CANCELLED 1
#define HARPY_CAPTURE_FAILED 2

#define OVERLAY_WINDOW_CLASS "HarpyRegionWindow"
#define OVERLAY_VIEW_CLASS "HarpyRegionView"

#define EVENT_MOUSE_DOWN 1
#define EVENT_MOUSE_UP 2
#define EVENT_MOUSE_DRAGGED 6
#define EVENT_KEY_DOWN 10
#define KEY_CODE_ESCAPE 53

#define MIN_SELECTION_POINTS 3.0
#define DIM_ALPHA 0.28
#define FRAME_LINE_WIDTH 2.0
#define FRAME_RED 0.85
#define FRAME_GREEN 0.20
#define FRAME_BLUE 0.20

enum { ST_ACTIVE = 0, ST_DONE = 1, ST_CANCELLED = 2 };

static int g_state;
static CGPoint g_start;
static CGRect g_sel;
static int g_have_sel;
static double g_scr_w, g_scr_h;
static id g_view;
static CGImageRef g_full;

static id ocls(const char *n) { return (id)objc_getClass(n); }
static SEL SL(const char *n) { return sel_registerName(n); }
static id call0(id o, const char *s) {
    return ((id (*)(id, SEL))objc_msgSend)(o, SL(s));
}

static void set_error(char *err, size_t err_len, const char *message) {
    if (err && err_len > 0) snprintf(err, err_len, "%s", message);
}

static void draw_rect_impl(id self, SEL cmd, CGRect dirty) {
    (void)self; (void)cmd; (void)dirty;
    id nsctx = call0(ocls("NSGraphicsContext"), "currentContext");
    if (!nsctx) return;
    CGContextRef c = (CGContextRef)((void *(*)(id, SEL))objc_msgSend)(nsctx, SL("CGContext"));
    if (!c) return;
    CGContextSetRGBFillColor(c, 0, 0, 0, DIM_ALPHA);
    CGContextFillRect(c, CGRectMake(0, 0, g_scr_w, g_scr_h));
    if (g_have_sel && g_sel.size.width > 0 && g_sel.size.height > 0) {
        CGContextClearRect(c, g_sel);
        CGContextSetRGBStrokeColor(c, FRAME_RED, FRAME_GREEN, FRAME_BLUE, 1.0);
        CGContextSetLineWidth(c, FRAME_LINE_WIDTH);
        CGContextStrokeRect(c, g_sel);
    }
}

static BOOL yes_impl(id self, SEL cmd) { (void)self; (void)cmd; return YES; }

static void redraw(void) { ((void (*)(id, SEL))objc_msgSend)(g_view, SL("display")); }

static Class overlay_window_class(void) {
    Class existing = objc_getClass(OVERLAY_WINDOW_CLASS);
    if (existing) return existing;
    Class cls = objc_allocateClassPair(objc_getClass("NSWindow"), OVERLAY_WINDOW_CLASS, 0);
    if (!cls) return NULL;
    class_addMethod(cls, SL("canBecomeKeyWindow"), (IMP)yes_impl, "B@:");
    objc_registerClassPair(cls);
    return cls;
}

static Class overlay_view_class(void) {
    Class existing = objc_getClass(OVERLAY_VIEW_CLASS);
    if (existing) return existing;
    Class cls = objc_allocateClassPair(objc_getClass("NSView"), OVERLAY_VIEW_CLASS, 0);
    if (!cls) return NULL;
    class_addMethod(cls, SL("drawRect:"), (IMP)draw_rect_impl,
                    "v@:{CGRect={CGPoint=dd}{CGSize=dd}}");
    objc_registerClassPair(cls);
    return cls;
}

static int encode_png(CGImageRef image, unsigned char **out_png, size_t *out_len,
                      char *err, size_t err_len) {
    CFMutableDataRef data = CFDataCreateMutable(NULL, 0);
    if (!data) {
        set_error(err, err_len, "не удалось выделить буфер PNG");
        return HARPY_CAPTURE_FAILED;
    }
    CGImageDestinationRef dest =
        CGImageDestinationCreateWithData(data, CFSTR("public.png"), 1, NULL);
    if (!dest) {
        CFRelease(data);
        set_error(err, err_len, "не удалось создать PNG-энкодер");
        return HARPY_CAPTURE_FAILED;
    }
    CGImageDestinationAddImage(dest, image, NULL);
    if (!CGImageDestinationFinalize(dest)) {
        CFRelease(dest);
        CFRelease(data);
        set_error(err, err_len, "не удалось закодировать PNG");
        return HARPY_CAPTURE_FAILED;
    }
    long len = CFDataGetLength(data);
    unsigned char *copy = malloc((size_t)len);
    if (!copy) {
        CFRelease(dest);
        CFRelease(data);
        set_error(err, err_len, "не хватило памяти под снимок");
        return HARPY_CAPTURE_FAILED;
    }
    memcpy(copy, CFDataGetBytePtr(data), (size_t)len);
    CFRelease(dest);
    CFRelease(data);
    *out_png = copy;
    *out_len = (size_t)len;
    return HARPY_CAPTURE_OK;
}

static int crop_selection(unsigned char **out_png, size_t *out_len, char *err, size_t err_len) {
    double sx = (double)CGImageGetWidth(g_full) / g_scr_w;
    double sy = (double)CGImageGetHeight(g_full) / g_scr_h;
    CGRect pixels = CGRectMake(g_sel.origin.x * sx,
                               (g_scr_h - (g_sel.origin.y + g_sel.size.height)) * sy,
                               g_sel.size.width * sx,
                               g_sel.size.height * sy);
    CGImageRef crop = CGImageCreateWithImageInRect(g_full, pixels);
    if (!crop) {
        set_error(err, err_len, "не удалось вырезать область");
        return HARPY_CAPTURE_FAILED;
    }
    int rc = encode_png(crop, out_png, out_len, err, err_len);
    CGImageRelease(crop);
    return rc;
}

typedef CGImageRef (*display_capture_fn)(CGDirectDisplayID);

int harpy_capture_region(unsigned char **out_png, size_t *out_len, char *err, size_t err_len) {
    id pool = call0(call0(ocls("NSAutoreleasePool"), "alloc"), "init");

    g_state = ST_ACTIVE;
    g_have_sel = 0;
    g_sel = CGRectMake(0, 0, 0, 0);
    g_full = NULL;
    g_view = NULL;

    CGRect screen = CGDisplayBounds(CGMainDisplayID());
    g_scr_w = screen.size.width;
    g_scr_h = screen.size.height;

    display_capture_fn capture_display =
        (display_capture_fn)dlsym(RTLD_DEFAULT, "CGDisplayCreateImage");
    if (!capture_display) {
        set_error(err, err_len, "CGDisplayCreateImage недоступна на этой macOS");
        call0(pool, "drain");
        return HARPY_CAPTURE_FAILED;
    }
    g_full = capture_display(CGMainDisplayID());
    if (!g_full) {
        set_error(err, err_len, "не удалось снять экран — проверь разрешение «Запись экрана»");
        call0(pool, "drain");
        return HARPY_CAPTURE_FAILED;
    }

    Class win_cls = overlay_window_class();
    Class view_cls = overlay_view_class();
    if (!win_cls || !view_cls) {
        CGImageRelease(g_full);
        set_error(err, err_len, "не удалось создать оверлей выделения");
        call0(pool, "drain");
        return HARPY_CAPTURE_FAILED;
    }

    id app = call0(ocls("NSApplication"), "sharedApplication");

    id win = call0((id)win_cls, "alloc");
    win = ((id (*)(id, SEL, CGRect, unsigned long, unsigned long, BOOL))objc_msgSend)(
        win, SL("initWithContentRect:styleMask:backing:defer:"),
        CGRectMake(0, 0, g_scr_w, g_scr_h), 0UL, 2UL, NO);
    ((void (*)(id, SEL, BOOL))objc_msgSend)(win, SL("setOpaque:"), NO);
    ((void (*)(id, SEL, id))objc_msgSend)(win, SL("setBackgroundColor:"),
                                          call0(ocls("NSColor"), "clearColor"));
    ((void (*)(id, SEL, long))objc_msgSend)(win, SL("setLevel:"),
                                            (long)CGShieldingWindowLevel());

    id view = call0((id)view_cls, "alloc");
    view = ((id (*)(id, SEL, CGRect))objc_msgSend)(view, SL("initWithFrame:"),
                                                   CGRectMake(0, 0, g_scr_w, g_scr_h));
    g_view = view;
    ((void (*)(id, SEL, id))objc_msgSend)(win, SL("setContentView:"), view);
    /* Окно удерживает вью само; наша ссылка из alloc/init больше не нужна. */
    call0(view, "release");
    ((void (*)(id, SEL, id))objc_msgSend)(win, SL("makeKeyAndOrderFront:"), (id)0);
    ((void (*)(id, SEL, BOOL))objc_msgSend)(app, SL("activateIgnoringOtherApps:"), YES);

    id distant = call0(ocls("NSDate"), "distantFuture");
    for (;;) {
        id ev = ((id (*)(id, SEL, unsigned long long, id, id, BOOL))objc_msgSend)(
            app, SL("nextEventMatchingMask:untilDate:inMode:dequeue:"),
            ~0ULL, distant, (id)kCFRunLoopDefaultMode, YES);
        if (!ev) continue;
        unsigned long et = ((unsigned long (*)(id, SEL))objc_msgSend)(ev, SL("type"));
        if (et == EVENT_KEY_DOWN) {
            unsigned short kc = ((unsigned short (*)(id, SEL))objc_msgSend)(ev, SL("keyCode"));
            if (kc == KEY_CODE_ESCAPE) g_state = ST_CANCELLED;
        } else if (et == EVENT_MOUSE_DOWN) {
            CGPoint p = ((CGPoint (*)(id, SEL))objc_msgSend)(ev, SL("locationInWindow"));
            g_start = p;
            g_sel = CGRectMake(p.x, p.y, 0, 0);
            g_have_sel = 1;
            redraw();
        } else if (et == EVENT_MOUSE_DRAGGED) {
            CGPoint p = ((CGPoint (*)(id, SEL))objc_msgSend)(ev, SL("locationInWindow"));
            double x = g_start.x < p.x ? g_start.x : p.x;
            double y = g_start.y < p.y ? g_start.y : p.y;
            g_sel = CGRectMake(x, y, fabs(p.x - g_start.x), fabs(p.y - g_start.y));
            redraw();
        } else if (et == EVENT_MOUSE_UP) {
            if (g_have_sel && g_sel.size.width >= MIN_SELECTION_POINTS &&
                g_sel.size.height >= MIN_SELECTION_POINTS)
                g_state = ST_DONE;
            else
                g_state = ST_CANCELLED;
        }
        ((void (*)(id, SEL, id))objc_msgSend)(app, SL("sendEvent:"), ev);
        if (g_state != ST_ACTIVE) break;
    }
    /* `close`, а не `orderOut:`: у NSWindow releasedWhenClosed = YES, и только
       close освобождает окно. С orderOut: полноэкранное окно с backing store
       оставалось в памяти навсегда — по одному на каждый снимок. */
    call0(win, "close");
    g_view = NULL;

    int rc = HARPY_CAPTURE_CANCELLED;
    if (g_state == ST_DONE) rc = crop_selection(out_png, out_len, err, err_len);

    CGImageRelease(g_full);
    g_full = NULL;
    call0(pool, "drain");
    return rc;
}

void harpy_capture_region_free(unsigned char *png) { free(png); }
