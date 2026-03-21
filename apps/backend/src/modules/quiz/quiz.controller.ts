import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { FastifyRequest } from "fastify";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { QuizService } from "./quiz.service";
import { SubmitQuizDto } from "./dto/submit-quiz.dto";

interface AuthenticatedRequest extends FastifyRequest {
  user: { id: string };
}

@ApiTags("Quiz")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("quiz")
export class QuizController {
  constructor(private readonly quizService: QuizService) {}

  @Get(":workspaceId")
  @ApiOperation({ summary: "Получить тест воркспейса" })
  getWorkspaceQuiz(
    @Param("workspaceId") workspaceId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.quizService.getWorkspaceQuiz(workspaceId, req.user.id);
  }

  @Post(":workspaceId/generate")
  @ApiOperation({ summary: "Запустить генерацию теста" })
  generate(
    @Param("workspaceId") workspaceId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.quizService.generate(workspaceId, req.user.id);
  }

  @Post(":workspaceId/submit")
  @ApiOperation({ summary: "Проверить ответы и начислить XP" })
  submit(
    @Param("workspaceId") workspaceId: string,
    @Req() req: AuthenticatedRequest,
    @Body() dto: SubmitQuizDto,
  ) {
    return this.quizService.submit(workspaceId, req.user.id, dto);
  }
}
