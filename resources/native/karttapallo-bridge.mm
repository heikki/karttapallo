/**
 * Native image processing bridge for Karttapallo.
 *
 * Provides HEIC→JPEG conversion, thumbnail generation, and video frame
 * extraction via ImageIO and AVFoundation — replacing sips/qlmanage subprocesses.
 *
 * Build:
 *   clang++ -shared -fPIC -O2 -fobjc-arc \
 *     -framework Foundation -framework ImageIO \
 *     -framework AVFoundation -framework CoreGraphics \
 *     -o native/libkarttapallo.dylib native/karttapallo-bridge.mm
 */

#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>
#import <CoreGraphics/CoreGraphics.h>
#import <CoreMedia/CoreMedia.h>
#import <AVFoundation/AVFoundation.h>

// kUTTypeJPEG is deprecated; CGImageDestinationCreateWithURL takes a
// UTI string directly, so use the raw "public.jpeg" identifier.
static CFStringRef const kJPEGType = CFSTR("public.jpeg");

// ---------- convertToJpeg ----------

extern "C" int convertToJpeg(const char* inPath, const char* outPath, float quality) {
    @autoreleasepool {
        NSString* input = [NSString stringWithUTF8String:inPath];
        NSString* output = [NSString stringWithUTF8String:outPath];

        NSURL* inputURL = [NSURL fileURLWithPath:input];
        NSURL* outputURL = [NSURL fileURLWithPath:output];

        CGImageSourceRef source = CGImageSourceCreateWithURL((__bridge CFURLRef)inputURL, NULL);
        if (!source) return 1;

        CGImageRef image = CGImageSourceCreateImageAtIndex(source, 0, NULL);
        // Copy source properties (includes EXIF orientation) so the output
        // JPEG retains the correct rotation metadata.
        CFDictionaryRef sourceProps = CGImageSourceCopyPropertiesAtIndex(source, 0, NULL);
        CFRelease(source);
        if (!image) {
            if (sourceProps) CFRelease(sourceProps);
            return 2;
        }

        CGImageDestinationRef dest = CGImageDestinationCreateWithURL(
            (__bridge CFURLRef)outputURL,
            kJPEGType,
            1, NULL
        );
        if (!dest) {
            CGImageRelease(image);
            if (sourceProps) CFRelease(sourceProps);
            return 3;
        }

        NSMutableDictionary* opts = sourceProps
            ? [NSMutableDictionary dictionaryWithDictionary:(__bridge NSDictionary*)sourceProps]
            : [NSMutableDictionary dictionary];
        opts[(__bridge NSString*)kCGImageDestinationLossyCompressionQuality] = @(quality);
        CGImageDestinationAddImage(dest, image, (__bridge CFDictionaryRef)opts);
        if (sourceProps) CFRelease(sourceProps);
        bool ok = CGImageDestinationFinalize(dest);

        CFRelease(dest);
        CGImageRelease(image);
        return ok ? 0 : 4;
    }
}

// ---------- resizeToJpeg ----------

extern "C" int resizeToJpeg(const char* inPath, const char* outPath, int maxDim, float quality) {
    @autoreleasepool {
        NSString* input = [NSString stringWithUTF8String:inPath];
        NSString* output = [NSString stringWithUTF8String:outPath];

        NSURL* inputURL = [NSURL fileURLWithPath:input];
        NSURL* outputURL = [NSURL fileURLWithPath:output];

        CGImageSourceRef source = CGImageSourceCreateWithURL((__bridge CFURLRef)inputURL, NULL);
        if (!source) return 1;

        // Use ImageIO thumbnail generation for efficient downscaling
        NSDictionary* thumbOpts = @{
            (__bridge NSString*)kCGImageSourceThumbnailMaxPixelSize: @(maxDim),
            (__bridge NSString*)kCGImageSourceCreateThumbnailFromImageAlways: @YES,
            (__bridge NSString*)kCGImageSourceCreateThumbnailWithTransform: @YES
        };
        CGImageRef thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, (__bridge CFDictionaryRef)thumbOpts);
        CFRelease(source);
        if (!thumbnail) return 2;

        CGImageDestinationRef dest = CGImageDestinationCreateWithURL(
            (__bridge CFURLRef)outputURL,
            kJPEGType,
            1, NULL
        );
        if (!dest) {
            CGImageRelease(thumbnail);
            return 3;
        }

        NSDictionary* opts = @{
            (__bridge NSString*)kCGImageDestinationLossyCompressionQuality: @(quality)
        };
        CGImageDestinationAddImage(dest, thumbnail, (__bridge CFDictionaryRef)opts);
        bool ok = CGImageDestinationFinalize(dest);

        CFRelease(dest);
        CGImageRelease(thumbnail);
        return ok ? 0 : 4;
    }
}

// ---------- extractVideoFrame ----------

extern "C" int extractVideoFrame(const char* videoPath, const char* outPath, int maxDim) {
    @autoreleasepool {
        NSString* video = [NSString stringWithUTF8String:videoPath];
        NSString* output = [NSString stringWithUTF8String:outPath];

        NSURL* videoURL = [NSURL fileURLWithPath:video];
        NSURL* outputURL = [NSURL fileURLWithPath:output];

        AVAsset* asset = [AVAsset assetWithURL:videoURL];
        AVAssetImageGenerator* generator = [[AVAssetImageGenerator alloc] initWithAsset:asset];
        generator.appliesPreferredTrackTransform = YES;
        generator.maximumSize = CGSizeMake(maxDim, maxDim);

        NSError* error = nil;
        CGImageRef frame = [generator copyCGImageAtTime:kCMTimeZero actualTime:NULL error:&error];
        if (!frame) return 1;

        CGImageDestinationRef dest = CGImageDestinationCreateWithURL(
            (__bridge CFURLRef)outputURL,
            kJPEGType,
            1, NULL
        );
        if (!dest) {
            CGImageRelease(frame);
            return 2;
        }

        NSDictionary* opts = @{
            (__bridge NSString*)kCGImageDestinationLossyCompressionQuality: @(0.9)
        };
        CGImageDestinationAddImage(dest, frame, (__bridge CFDictionaryRef)opts);
        bool ok = CGImageDestinationFinalize(dest);

        CFRelease(dest);
        CGImageRelease(frame);
        return ok ? 0 : 3;
    }
}

// ---------- runAppleScript ----------

extern "C" int runAppleScript(const char* script, char* errBuf, int errBufLen) {
    // NSAppleScript must run on the main thread. Bun's fetch handler can run
    // on internal worker threads, so the dispatch_sync hop below is required —
    // removing it intermittently deadlocks the worker. The isMainThread guard
    // avoids deadlocking when this is already on the main queue.
    __block int result = 0;
    void (^block)(void) = ^{
        @autoreleasepool {
            NSString* source = [NSString stringWithUTF8String:script];
            NSAppleScript* appleScript = [[NSAppleScript alloc] initWithSource:source];
            NSDictionary* errorInfo = nil;
            [appleScript executeAndReturnError:&errorInfo];
            if (errorInfo != nil) {
                NSString* msg = errorInfo[NSAppleScriptErrorMessage]
                                ?: [errorInfo description];
                const char* utf8 = [msg UTF8String];
                strlcpy(errBuf, utf8, errBufLen);
                result = 1;
            }
        }
    };
    if ([NSThread isMainThread]) {
        block();
    } else {
        dispatch_sync(dispatch_get_main_queue(), block);
    }
    return result;
}

// ---------- resolveActiveLibraryPath ----------
//
// Resolves the path of the Photos library that Photos.app currently treats as
// active, by decoding the `IPXDefaultLibraryURLBookmark` security-scoped
// bookmark stored in the Photos container preferences. Reading the container
// requires Full Disk Access.
//
// Return codes:
//   0  outBuf = POSIX path of the active library
//   1  no bookmark found (prefs unreadable-because-absent or key missing) —
//      caller should fall back to the system library at ~/Pictures
//   2  prefs exist but could not be read (Full Disk Access not granted) —
//      errBuf holds a message
//
// When a bookmark IS present but its volume is offline (e.g. an external drive
// that's unmounted or disconnected), we must NOT return 1: that makes the caller
// silently fall back to the system library and show the wrong photos / write to
// the wrong library (ADR 0012 forbids this). Instead we still return 0 with the
// bookmark's intended path — even though it isn't reachable — so the caller's
// own "does the database exist?" check fires the "Photos Library Unavailable"
// prompt. The path is decoded WITHOUT mounting (we don't want resolving a
// bookmark to silently mount a drive) and falls back to the path cached inside
// the bookmark data, which is readable while the volume is offline.
extern "C" int resolveActiveLibraryPath(char* outBuf, int outLen, char* errBuf, int errLen) {
    @autoreleasepool {
        NSString* home = NSHomeDirectory();
        NSString* prefsPath = [home stringByAppendingPathComponent:
            @"Library/Containers/com.apple.Photos/Data/Library/Preferences/com.apple.Photos.plist"];
        NSURL* prefsURL = [NSURL fileURLWithPath:prefsPath];

        NSError* readErr = nil;
        NSDictionary* prefs = [NSDictionary dictionaryWithContentsOfURL:prefsURL error:&readErr];
        if (prefs == nil) {
            // Distinguish "no prefs at all" (fresh install → fall back) from
            // "prefs are there but we can't read them" (Full Disk Access).
            if ([[NSFileManager defaultManager] fileExistsAtPath:prefsPath]) {
                NSString* msg = [readErr localizedDescription] ?: @"cannot read Photos preferences";
                strlcpy(errBuf, [msg UTF8String], errLen);
                return 2;
            }
            return 1;
        }

        NSData* bookmark = prefs[@"IPXDefaultLibraryURLBookmark"];
        if (![bookmark isKindOfClass:[NSData class]]) {
            return 1;
        }

        BOOL stale = NO;
        NSError* resolveErr = nil;
        NSURL* libURL = [NSURL URLByResolvingBookmarkData:bookmark
                                                  options:NSURLBookmarkResolutionWithoutUI |
                                                          NSURLBookmarkResolutionWithoutMounting
                                            relativeToURL:nil
                                      bookmarkDataIsStale:&stale
                                                    error:&resolveErr];

        NSString* path = [libURL path];
        if (path == nil) {
            // Volume offline: resolution can't produce a live URL. Recover the
            // library's path straight from the bookmark's cached resource values
            // (available without mounting) so the caller still learns *which*
            // library is expected and can prompt to reconnect it.
            NSDictionary* vals = [NSURL resourceValuesForKeys:@[NSURLPathKey]
                                              fromBookmarkData:bookmark];
            path = vals[NSURLPathKey];
        }
        if (path == nil) {
            // A present-but-undecodable bookmark is as good as none.
            return 1;
        }
        strlcpy(outBuf, [path UTF8String], outLen);
        return 0;
    }
}
