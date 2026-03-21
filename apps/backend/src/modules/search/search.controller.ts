import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { SearchService } from "./search.service";

@ApiTags("Search")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("search")
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @ApiOperation({ summary: "Глобальный поиск по воркспейсам и документам" })
  search(
    @Req() req: { user: { id: string } },
    @Query("q") q = "",
    @Query("type") type?: string,
  ) {
    return this.searchService.search(req.user.id, q, type);
  }
}
