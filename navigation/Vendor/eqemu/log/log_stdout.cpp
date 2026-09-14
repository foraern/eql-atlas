#include "log_stdout.h"
#include "log_types.h"
#include <stdio.h>
#include <time.h>

void EQEmu::Log::LogStdOut::OnMessage(LogType log_type, const std::string &message) {
	char time_buffer[512];
	time_t current_time;
	struct tm *time_info;
	
	time(&current_time);
	time_info = localtime(&current_time);
	
	strftime(time_buffer, 512, "[%m/%d/%y %H:%M:%S] ", time_info);
	
	switch(log_type) {
	case LogTrace:
		fprintf(stderr, "[Trace]%s%s\n", time_buffer, message.c_str());
		break;
	case LogDebug:
		fprintf(stderr, "[Debug]%s%s\n", time_buffer, message.c_str());
		break;
	case LogInfo:
		fprintf(stderr, "[Info]%s%s\n", time_buffer, message.c_str());
		break;
	case LogWarn:
		fprintf(stderr, "[Warn]%s%s\n", time_buffer, message.c_str());
		break;
	case LogError:
		fprintf(stderr, "[Error]%s%s\n", time_buffer, message.c_str());
		break;
	case LogFatal:
		fprintf(stderr, "[Fatal]%s%s\n", time_buffer, message.c_str());
		break;
	default:
		fprintf(stderr, "[All]%s%s\n", time_buffer, message.c_str());
		break;
	}
}
